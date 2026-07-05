/**
 * Shared types for the scheduled multi-platform publisher.
 *
 * A finished clip is enqueued once with a caption and a target publish time,
 * then fanned out to each requested platform. Every platform tracks its own
 * status so a failure on one never blocks the others, and terminal states
 * make re-runs idempotent (an already-published platform is never retried).
 */

export type PlatformId = "youtube" | "instagram" | "tiktok";

export const ALL_PLATFORMS: PlatformId[] = ["youtube", "instagram", "tiktok"];

/** Desired visibility of the finished post, mapped per platform. */
export type Visibility = "public" | "private" | "unlisted";

/**
 * Per-platform lifecycle:
 *   pending   → nothing sent yet
 *   uploaded  → bytes/container accepted by the platform but not yet live
 *               (IG container created, TikTok upload processing)
 *   scheduled → YouTube upload done with status.publishAt set; YouTube itself
 *               publishes at the target time. Once publishAt passes, the
 *               runner verifies the flip happened and forces the video public
 *               if it did not (see PlatformAdapter.finalize)
 *   published → live (or live as private/SELF_ONLY when that was requested)
 *   failed    → permanently failed; the error field says why
 *   manual    → the platform had no credentials when the post was created, so
 *               it is tracked as a reminder to post by hand. Terminal for the
 *               runner; connecting the platform later does not retro-fire it.
 */
export type PlatformStatus = "pending" | "uploaded" | "scheduled" | "published" | "failed" | "manual";

export type PlatformState = {
  status: PlatformStatus;
  /** Final platform id: YouTube videoId, Instagram media id, TikTok post/publish id. */
  postId?: string;
  /** Mid-flight handle: IG creation container id or TikTok publish_id. */
  containerId?: string;
  error?: string;
  attempts: number;
  /** Backoff gate — the runner skips this platform until this instant. */
  nextAttemptAt?: string;
  /** Soft lease so overlapping runners don't double-process one item. */
  claimedAt?: string;
  publishedAt?: string;
  /** When the platform accepted the bytes — feeds the YouTube quota meter. */
  uploadedAt?: string;
  /** Human note for the UI (e.g. why a post is "manual"). Not an error. */
  note?: string;
};

export type QueueItem = {
  id: string;
  /** Repo-relative path to the clip file (e.g. data/clips/outputs/<job>/export-x.mp4). */
  clipPath: string;
  /** Object key in the media host bucket once uploaded (needed for Instagram). */
  mediaKey?: string;
  /** Short title (YouTube title, TikTok title). */
  title: string;
  /** Long-form caption/description; hashtags are appended when posting. */
  caption: string;
  hashtags: string[];
  /** Target publish instant, stored as UTC ISO-8601. */
  publishAt: string;
  visibility: Visibility;
  createdAt: string;
  /** Only the requested platforms are present. */
  platforms: Partial<Record<PlatformId, PlatformState>>;
  /** Optional provenance for the UI/logs. */
  jobId?: string;
};

export type PostResult = {
  status: Extract<PlatformStatus, "uploaded" | "scheduled" | "published">;
  postId?: string;
  containerId?: string;
  /** Human-readable note for the log (e.g. "scheduled via status.publishAt"). */
  detail?: string;
};

/** What a dry run would send, without sending it. */
export type PublishPlan = {
  platform: PlatformId;
  endpoint: string;
  /** Redacted payload summary — never includes tokens. */
  payload: Record<string, unknown>;
  publishAtLocal: string;
  publishAtUtc: string;
  notes: string[];
};

export type PublishInput = {
  item: QueueItem;
  /** Absolute path to the media file, already resolved/downloaded by the runner. */
  localPath: string;
  /** Fresh public HTTPS URL for pull-based platforms, when hosting is configured. */
  publicUrl?: string;
};

export interface PlatformAdapter {
  id: PlatformId;
  /** True when every credential this adapter needs is configured. */
  configured(): boolean;
  /** Validates credentials (e.g. exercises the token refresh) without posting. */
  validateAuth(): Promise<void>;
  /** Builds the dry-run plan for an item without any network side effects. */
  buildPlan(input: PublishInput): PublishPlan;
  /**
   * Publishes (or schedules) the item. Called only when the item is due and
   * not in a terminal state. Throws TransientError/PermanentError from
   * http.ts to control retry behavior.
   */
  publish(input: PublishInput): Promise<PostResult>;
  /**
   * Follow-through for platforms with native scheduling: called once a
   * "scheduled" post's publishAt has passed, to verify the platform actually
   * made it public and force it public if not. Must be idempotent and must
   * not re-upload media. Returns "published" on success.
   */
  finalize?(item: QueueItem, state: PlatformState): Promise<PostResult>;
};
