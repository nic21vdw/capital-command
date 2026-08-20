import { recordQueueMutations, type QueueWriter } from "@/lib/publisher/audit";
import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";
import { preSchedulesItem } from "@/lib/publisher/nativeScheduling";
import { rearmItem, type RearmScope } from "@/lib/publisher/rearm";
import { FileQueueStore, R2QueueStore, type QueueStore } from "@/lib/publisher/store";
import type { BufferState, PlatformId, PlatformState, PostResult, QueueItem } from "@/lib/publisher/types";

/**
 * The publish queue and its per-platform state machine.
 *
 *   pending → uploaded → published
 *   pending → scheduled → published (YouTube native publishAt; once the slot
 *             time passes the runner verifies the video went public and
 *             forces it public if YouTube did not flip it)
 *   pending/uploaded → failed (permanent, with reason)
 *
 * Idempotency: `published` and `failed` are terminal, and `scheduled` only
 * ever finalizes (verify/flip visibility, never a re-upload), so re-runs of
 * the runner can never double-post. Transient errors keep the platform in
 * its current state and only bump attempts/nextAttemptAt.
 *
 * Every mutation of WHAT is on the queue — an item arriving, leaving, or being
 * moved to another slot — is also written to `data/publish-queue.log` with the
 * process and the entry point that did it (`audit.ts`). The per-platform state
 * machine below is not: a claim, an attempt count and a retry backoff are the
 * runner talking to itself, and logging them would bury the writes a person
 * actually needs to find. Each of these methods takes the caller's label; a
 * write that does not pass one is logged as `unattributed`, which is a finding
 * in itself rather than a silent gap.
 */

export class PublishQueue {
  private items = new Map<string, QueueItem>();
  private loaded = false;

  constructor(
    private readonly store: QueueStore,
    private readonly config: PublisherConfig = publisherConfig()
  ) {}

  describe(): string {
    return this.store.describe();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const raw = await this.store.load();
    if (!raw) return;
    for (const item of JSON.parse(raw) as QueueItem[]) this.items.set(item.id, item);
  }

  async save(): Promise<void> {
    const list = [...this.items.values()].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
    await this.store.save(JSON.stringify(list, null, 2));
  }

  async list(): Promise<QueueItem[]> {
    await this.load();
    return [...this.items.values()].sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  }

  async get(id: string): Promise<QueueItem | undefined> {
    await this.load();
    return this.items.get(id);
  }

  async add(item: QueueItem, writer: QueueWriter = "unattributed"): Promise<void> {
    await this.load();
    this.items.set(item.id, item);
    await this.save();
    await recordQueueMutations([
      { action: "add", writer, id: item.id, clipPath: item.clipPath, publishAt: item.publishAt }
    ]);
  }

  async applyPublishTimes(
    updates: Array<{ id: string; publishAt: string }>,
    writer: QueueWriter = "unattributed"
  ): Promise<number> {
    await this.load();
    const moved: QueueItem[] = [];
    for (const update of updates) {
      const item = this.items.get(update.id);
      if (!item || item.publishAt === update.publishAt) continue;
      item.publishAt = update.publishAt;
      moved.push(item);
    }
    if (moved.length > 0) {
      await this.save();
      await recordQueueMutations(
        moved.map((item) => ({
          action: "publish-time" as const,
          writer,
          id: item.id,
          clipPath: item.clipPath,
          publishAt: item.publishAt
        }))
      );
    }
    return moved.length;
  }

  async remove(id: string, writer: QueueWriter = "unattributed"): Promise<boolean> {
    await this.load();
    const item = this.items.get(id);
    const existed = this.items.delete(id);
    if (existed) {
      await this.save();
      await recordQueueMutations([
        { action: "remove", writer, id, clipPath: item?.clipPath, publishAt: item?.publishAt }
      ]);
    }
    return existed;
  }

  /**
   * Stamps the moment a fully-failed post was first shown. The board calls
   * this on every read, so `failedSeenAt` is the proof that the failure has
   * been on screen — which is what the retention sweep below waits for.
   * Returns the items newly stamped; saves once when anything changed.
   */
  async markFailedSeen(now: Date): Promise<QueueItem[]> {
    await this.load();
    const stamped: QueueItem[] = [];
    for (const item of this.items.values()) {
      if (isItemFullyFailed(item)) {
        if (!item.failedSeenAt) {
          item.failedSeenAt = now.toISOString();
          stamped.push(item);
        }
      } else if (item.failedSeenAt) {
        // Retried back to life — the next failure gets its own clock.
        item.failedSeenAt = undefined;
        stamped.push(item);
      }
    }
    if (stamped.length > 0) await this.save();
    return stamped;
  }

  /**
   * Sweeps fully-failed posts that have been on the board, unretried, for
   * longer than the retention window. Failures stay visible until then: the
   * board is where a permanent failure is discovered, and a post that vanished
   * on the next poll left nothing behind but a console line and a clip quietly
   * back in Draft. Saves once when anything changed; returns what it removed.
   */
  async purgeFailed(
    now: Date,
    retentionDays = FAILED_RETENTION_DAYS,
    writer: QueueWriter = "api-publish-purge"
  ): Promise<QueueItem[]> {
    await this.load();
    const removed: QueueItem[] = [];
    for (const [id, item] of this.items) {
      if (isFailedLongEnoughToPurge(item, now, retentionDays)) {
        this.items.delete(id);
        removed.push(item);
      }
    }
    if (removed.length > 0) {
      await this.save();
      await recordQueueMutations(
        removed.map((item) => ({
          action: "purge" as const,
          writer,
          id: item.id,
          clipPath: item.clipPath,
          publishAt: item.publishAt
        }))
      );
    }
    return removed;
  }

  /**
   * Puts blocked platforms of an item back to pending so the runner will act
   * on them again — the Retry button, and the re-arm a reconnect triggers.
   * Returns the platforms it revived; saves once when anything changed.
   */
  async rearm(item: QueueItem, scope: RearmScope = {}): Promise<PlatformId[]> {
    await this.load();
    const revived = rearmItem(item, scope);
    if (revived.length > 0) await this.save();
    return revived;
  }

  /**
   * Platforms of an item that the runner should act on at `now`:
   *  - never terminal states (published / failed / scheduled);
   *  - YouTube is due as soon as it is pending — the upload happens right
   *    away and YouTube itself publishes at publishAt, so a downtime-proof
   *    schedule exists even if the runner sleeps through the publish time;
   *  - Instagram/TikTok are due once publishAt <= now (no native scheduling);
   *  - "scheduled" posts come due again once publishAt <= now, so the runner
   *    can verify the platform really made them public (and force it if not);
   *  - respects retry backoff (nextAttemptAt) and soft claims.
   */
  duePlatforms(item: QueueItem, now: Date): PlatformId[] {
    const due: PlatformId[] = [];
    for (const [platform, state] of Object.entries(item.platforms) as [PlatformId, PlatformState][]) {
      const awaitingFlip = state.status === "scheduled";
      if (isTerminalStatus(state.status) && !awaitingFlip) continue;
      const timeDue = awaitingFlip
        ? new Date(item.publishAt).getTime() <= now.getTime()
        : preSchedulesItem(platform, item, now) || new Date(item.publishAt).getTime() <= now.getTime();
      if (!timeDue) continue;
      if (state.nextAttemptAt && new Date(state.nextAttemptAt).getTime() > now.getTime()) continue;
      if (state.claimedAt) {
        const claimAge = now.getTime() - new Date(state.claimedAt).getTime();
        if (claimAge < this.config.claimTimeoutMinutes * 60_000) continue;
      }
      due.push(platform);
    }
    return due;
  }

  async dueItems(now: Date): Promise<Array<{ item: QueueItem; platforms: PlatformId[] }>> {
    await this.load();
    const due: Array<{ item: QueueItem; platforms: PlatformId[] }> = [];
    for (const item of this.items.values()) {
      const platforms = this.duePlatforms(item, now);
      if (platforms.length > 0) due.push({ item, platforms });
    }
    return due.sort((a, b) => a.item.publishAt.localeCompare(b.item.publishAt));
  }

  /** Marks a platform as being processed right now (soft lease). */
  async claim(item: QueueItem, platform: PlatformId, now: Date): Promise<void> {
    const state = item.platforms[platform];
    if (!state) return;
    state.claimedAt = now.toISOString();
    await this.save();
  }

  /**
   * Stores a mid-flight handle the instant an adapter has one, without
   * touching status or attempt counts. Called before bytes are sent, so a run
   * that dies mid-upload still leaves the handle behind for the next one.
   */
  async recordHandle(item: QueueItem, platform: PlatformId, handle: string): Promise<void> {
    const state = item.platforms[platform];
    if (!state) return;
    state.containerId = handle;
    await this.save();
  }

  async clearDeadUpload(item: QueueItem, platform: PlatformId): Promise<void> {
    const state = item.platforms[platform];
    if (!state) return;
    state.containerId = undefined;
    state.childContainerIds = undefined;
    state.uploadedAt = undefined;
    await this.save();
  }

  async recordSuccess(item: QueueItem, platform: PlatformId, result: PostResult, now: Date): Promise<void> {
    const state = item.platforms[platform];
    if (!state) return;
    state.status = result.status;
    if (result.postId) state.postId = result.postId;
    if (result.containerId) state.containerId = result.containerId;
    if (result.childContainerIds?.length) state.childContainerIds = result.childContainerIds;
    if (result.status === "published") state.publishedAt = now.toISOString();
    // Any success means the platform accepted the bytes; the first stamp wins
    // so the quota meter counts each upload once.
    state.uploadedAt ??= now.toISOString();
    state.error = undefined;
    state.claimedAt = undefined;
    state.nextAttemptAt = undefined;
    await this.save();
  }

  /**
   * Puts a platform back to sleep without counting the try. A rate limit or an
   * upload backlog is not the item's fault and is not fixed by attempting it
   * two more times an hour apart — that only spends the attempts that a real
   * failure would need. The item keeps its status and its attempts and comes
   * back once the window has moved.
   */
  async deferAttempt(
    item: QueueItem,
    platform: PlatformId,
    message: string,
    retryAfterMinutes: number,
    now: Date
  ): Promise<void> {
    const state = item.platforms[platform];
    if (!state) return;
    state.error = message;
    state.claimedAt = undefined;
    state.nextAttemptAt = new Date(now.getTime() + retryAfterMinutes * 60_000).toISOString();
    await this.save();
  }

  /**
   * Records a failure. Transient errors schedule a retry with exponential
   * backoff until maxAttempts, then become permanent. Permanent errors mark
   * the platform failed immediately with the reason.
   */
  async recordFailure(
    item: QueueItem,
    platform: PlatformId,
    error: { message: string; transient: boolean },
    now: Date
  ): Promise<void> {
    const state = item.platforms[platform];
    if (!state) return;
    state.attempts += 1;
    state.error = error.message;
    state.claimedAt = undefined;
    if (!error.transient || state.attempts >= this.config.maxAttempts) {
      state.status = "failed";
      state.nextAttemptAt = undefined;
    } else {
      const delayMinutes = Math.min(
        this.config.backoffBaseMinutes * 2 ** (state.attempts - 1),
        this.config.backoffCapMinutes
      );
      state.nextAttemptAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
    }
    await this.save();
  }

  /**
   * Buffer state transitions, mirroring the per-platform trio above so the
   * Buffer delivery layer gets the same claim/backoff/idempotency guarantees.
   * The item's `buffer` field is seeded here when absent.
   */
  async claimBuffer(item: QueueItem, now: Date): Promise<void> {
    item.buffer ??= newBufferState();
    item.buffer.claimedAt = now.toISOString();
    await this.save();
  }

  async recordBufferSuccess(
    item: QueueItem,
    result: { status: Extract<BufferState["status"], "scheduled" | "published">; updateIds?: string[]; note?: string },
    now: Date
  ): Promise<void> {
    const state = (item.buffer ??= newBufferState());
    state.status = result.status;
    if (result.updateIds?.length) state.updateIds = result.updateIds;
    if (result.note !== undefined) state.note = result.note;
    if (result.status === "scheduled") state.scheduledAt ??= now.toISOString();
    if (result.status === "published") state.publishedAt = now.toISOString();
    state.error = undefined;
    state.claimedAt = undefined;
    state.nextAttemptAt = undefined;
    await this.save();
  }

  async recordBufferFailure(item: QueueItem, error: { message: string; transient: boolean }, now: Date): Promise<void> {
    const state = (item.buffer ??= newBufferState());
    state.attempts += 1;
    state.error = error.message;
    state.claimedAt = undefined;
    if (!error.transient || state.attempts >= this.config.maxAttempts) {
      state.status = "failed";
      state.nextAttemptAt = undefined;
    } else {
      const delayMinutes = Math.min(
        this.config.backoffBaseMinutes * 2 ** (state.attempts - 1),
        this.config.backoffCapMinutes
      );
      state.nextAttemptAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
    }
    await this.save();
  }

  /** Marks Buffer as a non-publishing reminder (Buffer not configured). */
  async recordBufferManual(item: QueueItem, note: string): Promise<void> {
    const state = (item.buffer ??= newBufferState());
    state.status = "manual";
    state.note = note;
    state.claimedAt = undefined;
    await this.save();
  }
}

/**
 * States the runner never publishes again (manual posts are reminders, not
 * jobs). "scheduled" is terminal for uploads but still comes due once its
 * publishAt passes, for the verify-went-public finalize step.
 */
export function isTerminalStatus(status: PlatformState["status"]): boolean {
  return status === "published" || status === "failed" || status === "scheduled" || status === "manual";
}

/**
 * True when the item has platforms and every one of them permanently failed —
 * i.e. nothing published, and nothing is still pending/scheduled/manual that
 * could yet succeed. A live Buffer route (anything but failed) also keeps the
 * item, so purging a fully-failed direct post never discards a Buffer post
 * that is still scheduled or already sent. Such an item is safe to drop.
 */
export function isItemFullyFailed(item: QueueItem): boolean {
  const states = Object.values(item.platforms);
  if (states.length === 0 || !states.every((state) => state?.status === "failed")) return false;
  return !item.buffer || item.buffer.status === "failed";
}

/** How long a seen, fully-failed post stays on the board before it is swept. */
export const FAILED_RETENTION_DAYS = 30;

/**
 * True when a fully-failed post is safe to sweep: it has been shown on the
 * board (`failedSeenAt`), and both that moment and its own slot are further
 * back than the retention window. An unseen failure is never swept, whatever
 * its age — that is the whole point of the stamp.
 */
export function isFailedLongEnoughToPurge(item: QueueItem, now: Date, retentionDays = FAILED_RETENTION_DAYS): boolean {
  if (!isItemFullyFailed(item) || !item.failedSeenAt) return false;
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const seen = new Date(item.failedSeenAt).getTime();
  const slot = new Date(item.publishAt).getTime();
  if (!Number.isFinite(seen) || !Number.isFinite(slot)) return false;
  return seen < cutoff && slot < cutoff;
}

export function newPlatformState(): PlatformState {
  return { status: "pending", attempts: 0 };
}

export function newBufferState(): BufferState {
  return { status: "pending", attempts: 0 };
}

let cachedQueue: PublishQueue | null = null;

/**
 * The process-wide queue over the configured backend. The R2 backend keeps
 * queue state in the bucket so the GitHub Actions cron and the local app see
 * the same queue.
 */
export function publishQueue(config = publisherConfig()): PublishQueue {
  if (cachedQueue) return cachedQueue;
  let store: QueueStore;
  if (config.queueBackend === "r2") {
    const host = mediaHost(config);
    if (!host) {
      throw new Error("PUBLISH_QUEUE_BACKEND=r2 requires the S3_* variables to be configured.");
    }
    store = new R2QueueStore(host);
  } else {
    store = new FileQueueStore();
  }
  cachedQueue = new PublishQueue(store, config);
  return cachedQueue;
}
