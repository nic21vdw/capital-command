import type { ThreadsVersion } from "@/lib/threads/config";

/**
 * Shared types for the Threads autopilot — the unattended loop that turns each
 * day's generated post pack into real, scheduled Threads posts.
 *
 * A batch is one day's worth of items across every connected account. Each item
 * is a single post on one account with its own target time and its own terminal
 * state, so a failure on one never blocks the rest of the day and re-running
 * the tick can never double-post.
 */

/**
 * Item lifecycle:
 *   pending   → not sent yet (waiting for its time, or retrying)
 *   published → live on Threads; `postId` is the Threads media id
 *   failed    → permanently failed; `error` says why
 *   skipped   → deliberately not posted: its time passed while nothing was
 *               running, or its account went away. Terminal — a missed slot is
 *               never fired late, so coming back from a weekend offline can't
 *               dump a backlog into the feed.
 */
export type ThreadsPostStatus = "pending" | "published" | "failed" | "skipped";

export type ThreadsQueueItem = {
  id: string;
  /** Local date key (YYYY-MM-DD) of the batch this item belongs to. */
  batchDate: string;
  /** 1-based slot within the day, matching the pack's post slot. */
  slot: number;
  /** Which connected account posts this (see ThreadsAccount.id). */
  accountId: string;
  /** Which version of the idea this is — the punchy one or the warm rewrite. */
  version: ThreadsVersion;
  /** Short topic label carried from the pack, for the log and the UI. */
  topic: string;
  format: string;
  /** Exactly what gets posted, already fitted to the Threads length limit. */
  text: string;
  /** Target publish instant, stored as UTC ISO-8601. */
  publishAt: string;
  status: ThreadsPostStatus;
  /** Threads media id of the published post. */
  postId?: string;
  /** Mid-flight handle: the Threads container created but not yet published. */
  containerId?: string;
  error?: string;
  /** Human note for the UI/log (e.g. why an item was skipped). Not an error. */
  note?: string;
  /**
   * Who put this on the queue. The autopilot plans one batch a day and decides
   * whether a day is already planned by looking at the queue — so a post added
   * from anywhere else has to be invisible to that decision, or the day's pack
   * silently never gets written. Absent means autopilot (every item written
   * before this existed).
   */
  origin?: "autopilot" | "pipeline";
  /** The pipeline run whose stream this post was written from. */
  sourceRunId?: string;
  attempts: number;
  /** Backoff gate — the runner ignores this item until this instant. */
  nextAttemptAt?: string;
  /** Soft lease so two overlapping ticks don't both post one item. */
  claimedAt?: string;
  publishedAt?: string;
  createdAt: string;
};

export type ThreadsOutcomeKind = "published" | "retrying" | "failed" | "skipped";

export type ThreadsOutcome = {
  itemId: string;
  slot: number;
  accountId: string;
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
  /** Set when the run did nothing at all (disabled, no account connected). */
  note?: string;
};

/** One account's tally within a day. */
export type ThreadsAccountSummary = {
  accountId: string;
  total: number;
  published: number;
  pending: number;
  failed: number;
  skipped: number;
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
  accounts: ThreadsAccountSummary[];
};

export type ThreadsPlanResult = {
  date: string;
  /** How many queue items the plan added (one per slot per account). */
  created: number;
  /**
   * Slots dropped because their time had already passed when planning ran — or,
   * when the batch started from the click, because the day had no room left.
   */
  droppedPastSlots: number;
  /** Start-now batches: when the first post fires and the spacing after it. */
  startedAt?: string;
  gapMinutes?: number;
  /** Set when nothing was planned, with the reason. */
  skipped?: string;
  /** Why the pack itself fell back to the idea library, when it did. */
  packReason?: string | null;
  packSource?: "ai" | "library";
};
