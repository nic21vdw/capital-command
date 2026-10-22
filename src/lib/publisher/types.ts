/**
 * Shared types for the scheduled multi-platform publisher.
 *
 * A finished clip is enqueued once with a caption and a target publish time,
 * then fanned out to each requested platform. Every platform tracks its own
 * status so a failure on one never blocks the others, and terminal states
 * make re-runs idempotent (an already-published platform is never retried).
 */

export type PlatformId = "youtube" | "instagram" | "tiktok" | "facebook";

export const ALL_PLATFORMS: PlatformId[] = ["youtube", "instagram", "tiktok", "facebook"];

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
 *               runner, but not for good: connecting that account re-arms the
 *               post back to pending (see rearm.ts), and so does the board's
 *               Retry button.
 */
export type PlatformStatus = "pending" | "uploaded" | "scheduled" | "published" | "failed" | "manual";

export type PlatformState = {
  status: PlatformStatus;
  /** Final platform id: YouTube videoId, Instagram media id, TikTok post/publish id. */
  postId?: string;
  /** Mid-flight handle: IG creation container id or TikTok publish_id. */
  containerId?: string;
  /**
   * Mid-flight handles for the parts of a multi-image post — the IG carousel's
   * child containers, or the Facebook photos uploaded unpublished before the
   * feed post is made. Kept so a retry resumes the deck it already uploaded
   * instead of uploading every picture a second time. Image posts only.
   */
  childContainerIds?: string[];
  error?: string;
  attempts: number;
  /**
   * When this leg last failed (ISO). `attempts` goes back to 0 on a re-arm, so
   * a repeat failure would otherwise look like the one already alerted; the
   * attention id uses this instead. Absent on legs that failed before it existed.
   */
  lastFailedAt?: string;
  /** Backoff gate — the runner skips this platform until this instant. */
  nextAttemptAt?: string;
  /** Soft lease so overlapping runners don't double-process one item. */
  claimedAt?: string;
  publishedAt?: string;
  /** When the platform accepted the bytes — feeds the YouTube quota meter. */
  uploadedAt?: string;
  /** Human note for the UI (e.g. why a post is "manual"). Not an error. */
  note?: string;
  /**
   * Set when the runner (or `publish:mirror`) added this platform to the post
   * by copying the lead platform's schedule, rather than the user choosing it.
   * The board tags such legs "Mirrored from YouTube" so a post showing up on a
   * platform nobody picked has an explanation. Absent on every leg booked by
   * hand, and on mirror legs added before this field existed.
   */
  mirroredFrom?: PlatformId;
  /**
   * When someone released this leg from the review hold (Settings > Publishing
   * sets a channel to hold). Absent on every leg that never needed releasing.
   */
  approvedAt?: string;
};

/**
 * Buffer (buffer.com) scheduling state — present only when a post is routed
 * through Buffer, which fans a single scheduled update out to every channel
 * connected inside Buffer and publishes it at the target time. Buffer is a
 * native-scheduling delivery layer that sits alongside (not inside) the four
 * direct-API platforms above, so it lives in its own optional field and never
 * changes how the existing per-platform machinery behaves.
 *
 *   pending   → nothing sent to Buffer yet
 *   scheduled → Buffer accepted the update(s) with a future scheduled time and
 *               will publish them itself; the runner later verifies they sent
 *   published → Buffer reported the update(s) as "sent"
 *   failed    → permanently failed; the error field says why
 *   manual    → Buffer isn't configured (no token/profiles), tracked as a
 *               reminder rather than a job. Terminal for the runner.
 */
export type BufferStatus = "pending" | "scheduled" | "published" | "failed" | "manual";

export type BufferState = {
  status: BufferStatus;
  /** Buffer update ids created for this post — one per targeted Buffer profile. */
  updateIds?: string[];
  error?: string;
  attempts: number;
  /** Backoff gate — the runner skips Buffer for this item until this instant. */
  nextAttemptAt?: string;
  /** Soft lease so overlapping runners don't double-schedule one item. */
  claimedAt?: string;
  /** When Buffer accepted the update(s). */
  scheduledAt?: string;
  publishedAt?: string;
  /** Human note for the UI/logs (e.g. why a post is "manual"). Not an error. */
  note?: string;
};

/** The audiences TikTok can post to; creator_info says which one an account may use. */
export type TiktokPrivacyLevel = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

/**
 * The creator's answers for one TikTok post (see tiktokPost.ts).
 *
 * "direct" posts straight to the profile and needs every field below —
 * TikTok requires the creator to have chosen them, with nothing preselected.
 * "inbox" sends the clip to TikTok as a draft and carries none of them,
 * because the creator makes those choices inside TikTok instead.
 */
export type TiktokPostOptions = {
  delivery: "direct" | "inbox";
  privacyLevel?: TiktokPrivacyLevel;
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  disclosure?: boolean;
  /** "Your brand" — the creator promoting themselves. */
  brandOrganic?: boolean;
  /** "Branded content" — a paid partnership. Cannot be posted privately. */
  brandedContent?: boolean;
  /** When the creator consented, for the audit trail. */
  consentedAt?: string;
};

export type QueueItem = {
  id: string;
  /**
   * Repo-relative path to the clip file (e.g. data/clips/outputs/<job>/export-x.mp4).
   * On an image post this is the FIRST image, so every path-based lookup in the
   * app keeps seeing the item (see images.ts).
   */
  clipPath: string;
  /**
   * "image" marks a picture post — one image, or an ordered deck. Absent means
   * video, which is what every item stored before image posts existed is.
   */
  mediaKind?: "image";
  /** An image post's pictures in posting order, repo-relative. */
  imagePaths?: string[];
  /** Hosted object key per image, index-aligned with imagePaths. */
  imageKeys?: string[];
  /** Original source render when clipPath is a derived vertical version of it. */
  sourceClipPath?: string;
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
  /**
   * "long" is a full-length YouTube upload: it goes up private and stays
   * private. Absent on shorts, reels, and everything queued before this field.
   */
  format?: "short" | "long";
  createdAt: string;
  /**
   * When this item was last changed and saved. Stamped by the queue on every
   * save that touches the item, so two writers editing the same item can be
   * merged by which change is newer. Absent until the item is next saved.
   */
  updatedAt?: string;
  /** Only the requested platforms are present. */
  platforms: Partial<Record<PlatformId, PlatformState>>;
  /** Optional provenance for the UI/logs. */
  jobId?: string;
  /**
   * The pipeline run this post came out of. `jobId` only ever covers clips, so
   * without this a run's long-form edit, its topic segments and its carousel
   * are invisible to anything asking "how much of this stream actually went
   * out?". Absent on posts scheduled by hand and on everything queued before
   * this field existed.
   */
  runId?: string;
  /**
   * The social account this post belongs to (see accounts.ts). Absent on
   * posts scheduled before multi-account support — those belong to the
   * platform's primary account.
   */
  accountId?: string;
  /**
   * Buffer scheduling state, present only when this post is routed through
   * Buffer (BUFFER_ENABLED). Absent on every post scheduled without Buffer —
   * those are untouched by the Buffer pass.
   */
  buffer?: BufferState;
  /**
   * When this post first showed on the board with every platform permanently
   * failed. Stamped by the board's own read, so the retention sweep can only
   * ever drop a failure that has been on screen — a post that failed while
   * nothing was watching is never swept before it is seen.
   */
  failedSeenAt?: string;
  /**
   * The creator's TikTok consent for this post (tiktokPost.ts). Absent on
   * posts scheduled before the panel existed and on every post that does not
   * target TikTok; the adapter then falls back to the inbox flow, which is
   * what those posts have always used.
   */
  tiktok?: TiktokPostOptions;
  /** Private workspace coordination lives on this same authoritative queue row. Always publication-blocked. */
  marketing?: MarketingState;
};

export type MarketingCommandResult = {
  jobId: string;
  revision: number;
  operation: "adopt" | "review" | "request_edits" | "retry" | "claim" | "record_outcome";
  persisted: true;
  reviewed: boolean;
  workerState?: MarketingWorker["state"];
  attemptId?: string;
};
export type MarketingWorker = {
  attemptId: string;
  fence: number;
  state: "claimed" | "prepared" | "failed_before_send" | "uncertain" | "accepted" | "published";
  claimedAt: string;
  target?: import("@/lib/integrations/marketing/safety").Target;
  postId?: string;
  publishedUrl?: string;
  publishedUrlVerified?: boolean;
};
export type MarketingState = {
  schema: 1;
  ownerId: string;
  revision: number;
  fingerprint: string;
  publication: "blocked";
  review?: { target: import("@/lib/integrations/marketing/safety").Target; at: string };
  edit?: { instructions: string; at: string };
  worker?: MarketingWorker;
  /** Retained in the row so deletion cannot erase command/delivery dedupe. */
  deletedAt?: string;
  commands: Record<string, { requestHash: string; result: MarketingCommandResult }>;
};

export type PostResult = {
  status: Extract<PlatformStatus, "uploaded" | "scheduled" | "published">;
  postId?: string;
  containerId?: string;
  /** The parts a multi-image post was assembled from — what it actually posted. */
  childContainerIds?: string[];
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

/** Options for `PlatformAdapter.finalize`; see `PublishInput.publishNow`. */
export type FinalizeOptions = { publishNow?: boolean };

export type PublishInput = {
  item: QueueItem;
  /** Absolute path to the media file, already resolved/downloaded by the runner. */
  localPath: string;
  /** Fresh public HTTPS URL for pull-based platforms, when hosting is configured. */
  publicUrl?: string;
  /**
   * Image posts only: every picture of the post in order, resolved the same way
   * `localPath`/`publicUrl` are. `localPath` mirrors the first entry so an
   * adapter that only knows about video still has something coherent to read.
   */
  images?: {
    localPaths: string[];
    publicUrls: string[];
  };
  /**
   * Persists a mid-flight handle to the queue immediately, before the adapter
   * carries on. An adapter that is about to do something the platform cannot
   * undo — sending video bytes — calls this with the handle that identifies
   * that attempt, so a crash or network drop mid-upload leaves a trail the
   * next run can resume instead of starting a second upload.
   */
  onHandle?: (handle: string) => Promise<void>;
  /**
   * True only for the board's explicit "Publish now" (the forced run). An
   * adapter that can hold a post for its slot (YouTube) then goes live at once
   * instead. Never set by a retry or the scheduler - they must keep a future
   * slot's post waiting.
   */
  publishNow?: boolean;
  /**
   * How long this adapter may spend waiting on the platform to finish
   * processing before it gives the run back. The runner shares one budget
   * across the items of a platform whose API is polled, so a queue full of
   * slow posts cannot spend the whole run on one platform.
   */
  pollBudgetMs?: number;
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
  finalize?(item: QueueItem, state: PlatformState, options?: FinalizeOptions): Promise<PostResult>;
};
