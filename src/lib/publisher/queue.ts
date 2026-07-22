import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";
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

  async add(item: QueueItem): Promise<void> {
    await this.load();
    this.items.set(item.id, item);
    await this.save();
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const existed = this.items.delete(id);
    if (existed) await this.save();
    return existed;
  }

  /**
   * Drops every item whose platforms have all permanently failed. A fully
   * failed post can never publish — it only holds its schedule slot hostage —
   * so clearing it out (on the board's next load) frees the slot for a fresh
   * clip. Items where any platform still succeeded, is pending, or is
   * scheduled are kept, because removing them would erase a real post. Saves
   * once when anything changed and returns the removed items.
   */
  async purgeFailed(): Promise<QueueItem[]> {
    await this.load();
    const removed: QueueItem[] = [];
    for (const [id, item] of this.items) {
      if (isItemFullyFailed(item)) {
        this.items.delete(id);
        removed.push(item);
      }
    }
    if (removed.length > 0) await this.save();
    return removed;
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
        : platform === "youtube" || new Date(item.publishAt).getTime() <= now.getTime();
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

  async recordSuccess(item: QueueItem, platform: PlatformId, result: PostResult, now: Date): Promise<void> {
    const state = item.platforms[platform];
    if (!state) return;
    state.status = result.status;
    if (result.postId) state.postId = result.postId;
    if (result.containerId) state.containerId = result.containerId;
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
