import { localCalendarParts } from "@/lib/publisher/time";
import { formatSlotDateTime, formatSlotTime } from "@/lib/timeFormat";
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
 *   that is one post (two per-account rows in the queue). Day Summary counts the
 *   same way (a pack slot is one event; a hand-added post is its own). The page
 *   used to ALSO print the per-account row count ("13 sends") and the size of
 *   the written pack ("6 posts") beside it; one screen with three numbers for
 *   one day is why none of them could be trusted. Posts is the only count.
 * - SENT means published. A post counts as sent only when every account's
 *   version is out; one still waiting keeps it waiting, one that failed on any
 *   account is failed.
 * - NEXT is the earliest pending row by its OWN time, on any day, and the
 *   account that will send it. It is not the first slot of today's pack and
 *   not the first retry window.
 *
 * Pure and dependency-free (types only) so a client component can import it.
 */

export type ThreadsPostState = "sent" | "waiting" | "failed" | "skipped";

export type ThreadsTodaySummary = {
  dateKey: string;
  /** Distinct posts today: a pack slot across all accounts, or one hand-added post. */
  posts: number;
  /** Of `posts`, the ones that came from the day's written pack (a slot across all accounts). */
  fromPack: number;
  /** Of `posts`, the ones added outside the pack: written by hand or made by a stream (origin "pipeline"). */
  added: number;
  sent: number;
  /** Posts still scheduled: at least one account's version has not gone out yet. */
  waiting: number;
  failed: number;
  skipped: number;
  /** Earliest pending row in the whole queue by its own time, and the account that sends it. */
  next: { at: string; topic: string; accountId: string } | null;
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
  return pending[0] ? { at: new Date(pending[0].publishAt).toISOString(), topic: pending[0].topic, accountId: pending[0].accountId } : null;
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
  const added = [...groups.keys()].filter((key) => key.startsWith("pipeline:")).length;
  const tally: Record<ThreadsPostState, number> = { sent: 0, waiting: 0, failed: 0, skipped: 0 };
  for (const group of groups.values()) tally[postState(group.map((item) => item.status))] += 1;
  return {
    dateKey,
    posts: groups.size,
    fromPack: groups.size - added,
    added,
    ...tally,
    next: nextPending(all)
  };
}

/** "Oct 10, 8:00 PM" in the autopilot's own time zone - the same words every other screen uses for a slot. */
export function formatThreadsStamp(iso: string | null | undefined, timeZone: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "Not yet";
  return formatSlotDateTime(iso, timeZone);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * One short sentence that reconciles the pack's size with today's count when a
 * post was added outside the pack: "6 from the pack + 1 added by hand or from a
 * stream = 7 posts today". Null when nothing was added, so the two numbers agree
 * and there is nothing to explain.
 */
export function packSplitNote(summary: Pick<ThreadsTodaySummary, "posts" | "fromPack" | "added">): string | null {
  if (summary.added <= 0) return null;
  return `${summary.fromPack} from today's pack + ${summary.added} added by hand or from a stream = ${plural(summary.posts, "post")} today.`;
}

/**
 * The card's headline: ONE number and ONE next step - "7 posts today - next at
 * 2:30 PM on Account 2". The time drops the date when it is on the day being
 * summarised and keeps it when the next post is on another day, and the account
 * is named only when `accountLabel` is given (the page passes it when more than
 * one account posts, since one account needs no telling apart).
 */
export function todayHeadline(
  summary: ThreadsTodaySummary,
  options: { timeZone: string; accountLabel?: (accountId: string) => string }
): string {
  const { next } = summary;
  const nextStep = next
    ? ` - next at ${
        localCalendarParts(next.at, options.timeZone).dateKey === summary.dateKey ? formatSlotTime(next.at, options.timeZone) : formatSlotDateTime(next.at, options.timeZone)
      }${options.accountLabel ? ` on ${options.accountLabel(next.accountId)}` : ""}`
    : "";
  if (summary.posts === 0) return `Nothing queued for today yet${nextStep}`;
  const today = plural(summary.posts, "post") + " today";
  if (next) return `${today}${nextStep}`;
  if (summary.failed > 0) return `${today} - ${summary.failed} failed, retry below`;
  if (summary.skipped > 0) return `${today} - ${summary.sent} sent, ${summary.skipped} skipped`;
  return `${today} - all sent`;
}

/**
 * The page header: what the autopilot will do, and the state of the pack, with
 * NO counts of today's posts. Those live in the card's headline
 * (`todayHeadline`); the header used to repeat them from other sources - the
 * pack's size, the configured posts per account per day - and so read "6 posts"
 * above a card that said "7 posts today". The one number left is the configured
 * cadence, and only while no account is connected, when there is no day to count.
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
  pack: { label: string } | null;
}): string {
  const who = input.accounts > 1 ? "each of your accounts" : "your account";
  const cadence =
    input.accounts === 0
      ? `Once a Threads account is connected it will post up to ${plural(input.postsPerDay, "time")} a day.`
      : `The autopilot is set to post on ${who}${input.linkReplies ? ", each post followed by a link reply" : ""}.`;
  const pack = input.pack
    ? `${input.pack.label} is written - copy anything from it to post by hand.`
    : "No pack is written yet - press Write today's posts to draft one from your positioning brief.";
  if (!input.known) return pack;
  const state = input.paused
    ? " It is paused on Automations, so nothing goes out until you resume it."
    : input.armed
      ? " It sends them for you, one at a time through the day."
      : "";
  return `${pack} ${cadence}${state}`;
}
