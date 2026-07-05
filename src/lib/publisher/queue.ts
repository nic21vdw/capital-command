import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";
import { FileQueueStore, R2QueueStore, type QueueStore } from "@/lib/publisher/store";
import type { PlatformId, PlatformState, PostResult, QueueItem } from "@/lib/publisher/types";

/**
 * The publish queue and its per-platform state machine.
 *
 *   pending → uploaded → published
 *   pending → scheduled (YouTube native publishAt — terminal for the runner)
 *   pending/uploaded → failed (permanent, with reason)
 *
 * Idempotency: `published`, `scheduled` and `failed` are terminal, so re-runs
 * of the runner can never double-post. Transient errors keep the platform in
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
   * Platforms of an item that the runner should act on at `now`:
   *  - never terminal states (published / failed / scheduled);
   *  - YouTube is due as soon as it is pending — the upload happens right
   *    away and YouTube itself publishes at publishAt, so a downtime-proof
   *    schedule exists even if the runner sleeps through the publish time;
   *  - Instagram/TikTok are due once publishAt <= now (no native scheduling);
   *  - respects retry backoff (nextAttemptAt) and soft claims.
   */
  duePlatforms(item: QueueItem, now: Date): PlatformId[] {
    const due: PlatformId[] = [];
    for (const [platform, state] of Object.entries(item.platforms) as [PlatformId, PlatformState][]) {
      if (isTerminalStatus(state.status)) continue;
      const timeDue = platform === "youtube" || new Date(item.publishAt).getTime() <= now.getTime();
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
}

/** States the runner never touches again (manual posts are reminders, not jobs). */
export function isTerminalStatus(status: PlatformState["status"]): boolean {
  return status === "published" || status === "failed" || status === "scheduled" || status === "manual";
}

export function newPlatformState(): PlatformState {
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
