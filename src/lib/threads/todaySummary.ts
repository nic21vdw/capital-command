import type { ThreadsQueueItem } from "@/lib/threads/types";

/**
 * "What is today for the Threads autopilot?", answered ONCE.
 *
 * The Threads page, the Automations card and the Day Summary each counted
 * their own way, so one day read "6/13 posted today", "6 posts" and "7 today
 * (3 published, 4 scheduled)" side by side. The rules, in one place:
 *
 * - TODAY is the queue's own batch for the local day, every account, and it
 *   includes hand-added and stream posts (origin "pipeline") - a post you can
 *   see in the queue is a post that is going out today.
 * - A POST is one idea. Two accounts each post their own version of it, so
 *   that is one post and two sends. Day Summary counts the same way (a pack
 *   slot is one event; a hand-added post is its own).
 * - SENT means published. A post counts as sent only when every account's
 *   version is out; one still waiting keeps it waiting, one that failed on any
 *   account is failed.
 * - NEXT is the earliest pending row by its OWN time, on any day. It is not
 *   the first slot of today's pack and not the first retry window.
 *
 * Pure and dependency-free (types only) so a client component can import it.
 */

export type ThreadsPostState = "sent" | "waiting" | "failed" | "skipped";

export type ThreadsTodaySummary = {
  dateKey: string;
  /** Distinct posts today: a pack slot across all accounts, or one hand-added post. */
  posts: number;
  sent: number;
  waiting: number;
  failed: number;
  skipped: number;
  /** The same day counted per account: what each account actually sends. */
  sends: number;
  sendsDone: number;
  /** Accounts that have something queued today. */
  accounts: number;
  /** Earliest pending row in the whole queue by its own time. */
  next: { at: string; topic: string } | null;
};

/** One post's state from its per-account rows. Same roll-up as the calendar's `threadsSlotStatus`. */
export function postState(statuses: ThreadsQueueItem["status"][]): ThreadsPostState {
  if (statuses.length > 0 && statuses.every((status) => status === "published")) return "sent";
  if (statuses.length > 0 && statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "pending")) return "waiting";
  // Sent on some accounts and skipped on the rest.
  return "sent";
}

type Row = Pick<ThreadsQueueItem, "id" | "batchDate" | "slot" | "accountId" | "status" | "publishAt" | "origin" | "topic">;

export function nextPending(items: Row[]): ThreadsTodaySummary["next"] {
  const pending = items
    .filter((item) => item.status === "pending" && Number.isFinite(Date.parse(item.publishAt)))
    .sort((a, b) => Date.parse(a.publishAt) - Date.parse(b.publishAt));
  return pending[0] ? { at: new Date(pending[0].publishAt).toISOString(), topic: pending[0].topic } : null;
}

export function summarizeThreadsToday(items: Row[] | undefined, dateKey: string): ThreadsTodaySummary {
  const all = items ?? [];
  const rows = all.filter((item) => item.batchDate === dateKey);
  const groups = new Map<string, Row[]>();
  for (const item of rows) {
    // A stream or hand-added post carries its own slot numbering: it is one post.
    const key = item.origin === "pipeline" ? `pipeline:${item.id}` : `slot:${item.slot}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const tally: Record<ThreadsPostState, number> = { sent: 0, waiting: 0, failed: 0, skipped: 0 };
  for (const group of groups.values()) tally[postState(group.map((item) => item.status))] += 1;
  return {
    dateKey,
    posts: groups.size,
    ...tally,
    sends: rows.length,
    sendsDone: rows.filter((item) => item.status === "published").length,
    accounts: new Set(rows.map((item) => item.accountId)).size,
    next: nextPending(all)
  };
}

/** "Oct 10, 8:00 PM" in the autopilot's own time zone - the same words the Automations page uses. */
export function formatThreadsStamp(iso: string | null | undefined, timeZone: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "Not yet";
  return new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The headline: "3 of 7 posts sent today". */
export function todayHeadline(summary: ThreadsTodaySummary): string {
  if (summary.posts === 0) return "Nothing queued for today yet";
  return `${summary.sent} of ${plural(summary.posts, "post")} sent today`;
}

/** Why a second number exists: per-account sends. Empty when there is nothing to explain. */
export function todaySendsNote(summary: ThreadsTodaySummary): string {
  if (summary.sends === summary.posts || summary.accounts < 2) return "";
  return `That is ${summary.sendsDone} of ${summary.sends} sends across ${summary.accounts} accounts - each account posts its own version of every post.`;
}

/**
 * The page header: the REAL cadence (posts a day per account, link replies only
 * when they are on) and the size of the pack actually written, instead of the
 * pack generator's ideal that a short or older pack never matched.
 */
export function autopilotHeader(input: {
  postsPerDay: number;
  accounts: number;
  linkReplies: boolean;
  paused: boolean;
  armed: boolean;
  /** False until the autopilot's status has loaded: nothing about its cadence is claimed before that. */
  known: boolean;
  /** The pack on screen, with what to call it ("Today's pack"); null when none is written. */
  pack: { posts: number; replies: number; label: string } | null;
}): string {
  const perAccount = input.accounts > 1 ? ` on each of ${input.accounts} accounts` : "";
  const cadence =
    input.accounts === 0
      ? `Once a Threads account is connected it will post ${plural(input.postsPerDay, "time")} a day.`
      : `The autopilot is set to post ${plural(input.postsPerDay, "time")} a day${perAccount}${input.linkReplies ? ", each followed by a link reply" : ""}.`;
  const pack = input.pack
    ? `${input.pack.label} has ${plural(input.pack.posts, "post")} and ${plural(input.pack.replies, "reply", "replies")} to use by hand.`
    : "No pack is written yet - press Write today's posts to draft one from your positioning brief.";
  if (!input.known) return pack;
  const state = input.paused
    ? " It is paused on Automations, so nothing goes out until you resume it."
    : input.armed
      ? " It sends them for you, one at a time through the day."
      : "";
  return `${pack} ${cadence}${state}`;
}
