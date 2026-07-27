/**
 * Shared types for the Threads autopilot — the unattended loop that turns each
 * day's generated post pack into real, scheduled Threads posts.
 *
 * A batch is one day's worth of items. Every item is a single Threads post
 * with its own target time and its own terminal state, so a failure on one
 * post never blocks the rest of the day and re-running the tick can never
 * double-post.
 */

/**
 * Which half of a slot an item is. The pack writes two versions of every idea:
 * `text` (the punchier X-flavoured line) and `threadsVariant` (warmer, written
 * for Threads). Both go out per slot — the main as the top-level post, the
 * variant either as a reply under it or as its own post a few minutes later.
 */
export type ThreadsPostRole = "main" | "variant";

/**
 * Item lifecycle:
 *   pending   → not sent yet (waiting for its time, or retrying)
 *   published → live on Threads; `postId` is the Threads media id
 *   failed    → permanently failed; `error` says why
 *   skipped   → deliberately not posted (its time passed while nothing was
 *               running, or the post it replies to never went live). Terminal:
 *               a missed slot is never fired late, so coming back from a
 *               weekend offline can't dump a backlog into the feed.
 */
export type ThreadsPostStatus = "pending" | "published" | "failed" | "skipped";

export type ThreadsQueueItem = {
  id: string;
  /** Local date key (YYYY-MM-DD) of the batch this item belongs to. */
  batchDate: string;
  /** 1-based slot within the day, matching the pack's post slot. */
  slot: number;
  role: ThreadsPostRole;
  /** Short topic label carried from the pack, for the log and the UI. */
  topic: string;
  format: string;
  /** Exactly what gets posted, already fitted to the Threads length limit. */
  text: string;
  /** Target publish instant, stored as UTC ISO-8601. */
  publishAt: string;
  /**
   * Set on a variant that posts as a reply: the id of the queue item whose
   * published post it replies to. The variant waits for that post to be live
   * and is skipped if it never gets there.
   */
  replyToItemId?: string;
  status: ThreadsPostStatus;
  /** Threads media id of the published post. */
  postId?: string;
  /** Mid-flight handle: the Threads container created but not yet published. */
  containerId?: string;
  error?: string;
  /** Human note for the UI/log (e.g. why an item was skipped). Not an error. */
  note?: string;
  attempts: number;
  /** Backoff gate — the runner ignores this item until this instant. */
  nextAttemptAt?: string;
  /** Soft lease so two overlapping ticks don't both post one item. */
  claimedAt?: string;
  publishedAt?: string;
  createdAt: string;
};

export type ThreadsOutcomeKind = "published" | "retrying" | "failed" | "skipped" | "waiting";

export type ThreadsOutcome = {
  itemId: string;
  slot: number;
  role: ThreadsPostRole;
  outcome: ThreadsOutcomeKind;
  detail: string;
};

export type ThreadsRunReport = {
  ran: string;
  published: number;
  failed: number;
  skipped: number;
  outcomes: ThreadsOutcome[];
  dryRun: boolean;
  /** Set when the run did nothing at all (disabled, not connected). */
  note?: string;
};

/** One day's tally, for the dashboard card and the CLI status output. */
export type ThreadsBatchSummary = {
  date: string;
  total: number;
  published: number;
  pending: number;
  failed: number;
  skipped: number;
  /** UTC ISO of the next item still waiting to go out, if any. */
  nextAt?: string;
};

export type ThreadsPlanResult = {
  date: string;
  /** How many queue items the plan added (2 per slot in the default mode). */
  created: number;
  /** Slots dropped because their time had already passed when planning ran. */
  droppedPastSlots: number;
  /** Set when nothing was planned, with the reason. */
  skipped?: string;
  /** Why the pack itself fell back to the idea library, when it did. */
  packReason?: string | null;
  packSource?: "ai" | "library";
};
