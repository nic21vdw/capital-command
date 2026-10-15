import type { ThreadsQueueItem } from "@/lib/threads/types";

/**
 * "May today's pack be written again, and what happens to the queue if it is?"
 * - answered ONCE, for the button, its confirmation and the route that does it.
 *
 * Rewriting the pack replaces the pack in the app data; the queue is a separate
 * file with its own copy of every post. So a rewrite that left the queue alone
 * would put one pack on screen and send another, and a rewrite that touched a
 * row already on Threads could put the same slot out twice. The rules:
 *
 * - Once ANY autopilot row for the day has started (published, a post id, a
 *   container created, or claimed by a run in flight) the pack is frozen. A sent
 *   post cannot be unsent, and its slot is the only thing stopping the new pack
 *   from posting an idea the feed already saw.
 * - A post that failed can still be retried with its old wording, so it freezes
 *   the pack too: the retry and the new pack's slot would both go out.
 * - Rows still waiting (and ones skipped, which are out of the running) are
 *   REPLACED by the new pack's posts at the new pack's times, so what is on screen
 *   is what will be sent. That needs the autopilot able to plan, so a paused or
 *   unconnected autopilot with such rows refuses rather than leave the old copy
 *   queued behind a new pack.
 * - Hand-added and stream posts (origin "pipeline") are never touched.
 *
 * Pure and dependency-free (types only) so the client component can import it.
 */

type Row = Pick<ThreadsQueueItem, "batchDate" | "slot" | "status" | "origin" | "postId" | "containerId" | "claimedAt" | "publishAttemptedAt">;

/** Has this row reached Threads, or been picked up by a run that is sending it? */
export function hasStarted(item: Pick<ThreadsQueueItem, "status" | "postId" | "containerId" | "claimedAt" | "publishAttemptedAt">): boolean {
  return item.status === "published" || Boolean(item.postId || item.containerId || item.claimedAt || item.publishAttemptedAt);
}

export const REWRITE_STARTED_REASON = "Today's posts have started going out - edit or skip individual posts instead.";
/**
 * Said instead when no Threads account is connected. The rows say a post went
 * out (a post id), but nothing can post right now, and the page is already
 * saying "No Threads account is connected" - "have started going out" beside it
 * claimed both at once. This keeps the pack and says why, without the claim.
 */
export const REWRITE_STARTED_NO_ACCOUNT_REASON = "Today's pack is kept because some of its posts were already sent earlier. Edit or skip individual posts instead.";
export const REWRITE_FAILED_REASON = "A post failed to send today - retry or remove it on Scheduled & sent before rewriting the pack.";

export type RewriteCounts = {
  /** Distinct posts (a slot across every account) with a row that has started. */
  sent: number;
  /** Distinct posts still waiting to go out. */
  queued: number;
  /** Individual rows that will be sent, across accounts. */
  queuedSends: number;
  failed: number;
  skipped: number;
  /** Hand-added and stream posts today, which a rewrite leaves alone. */
  handAdded: number;
};

export type RewriteDecision = {
  /** "write": no pack for today yet. "rewrite": one exists and this would replace it. */
  mode: "write" | "rewrite";
  allowed: boolean;
  /** Why not: shown beside the disabled button and returned by the route. */
  reason: string | null;
  counts: RewriteCounts;
  /** Rows in the queue a rewrite would replace (waiting plus skipped, autopilot only). */
  replaces: number;
  /** What the confirmation says, in order. Empty unless this is an allowed rewrite. */
  confirm: string[];
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function rewriteDecision(input: {
  packExists: boolean;
  items: Row[] | undefined;
  date: string;
  /** The autopilot's state: whether it can plan a new batch onto the queue. */
  autopilot?: { paused?: boolean; blockedReason?: string | null; noAccount?: boolean };
  pack?: { posts: number; replies: number } | null;
}): RewriteDecision {
  const rows = (input.items ?? []).filter((item) => item.batchDate === input.date);
  const autopilotRows = rows.filter((item) => item.origin !== "pipeline");
  const slotsOf = (list: Row[]) => new Set(list.map((item) => item.slot)).size;

  const started = autopilotRows.filter(hasStarted);
  const startedSlots = new Set(started.map((item) => item.slot));
  // A slot with one account's row out is "sent" whatever the other row says.
  const waiting = autopilotRows.filter((item) => item.status === "pending" && !startedSlots.has(item.slot));
  const failed = autopilotRows.filter((item) => item.status === "failed" && !hasStarted(item));
  const skipped = autopilotRows.filter((item) => item.status === "skipped" && !hasStarted(item) && !startedSlots.has(item.slot));
  const counts: RewriteCounts = {
    sent: startedSlots.size,
    queued: slotsOf(waiting),
    queuedSends: waiting.length,
    failed: slotsOf(failed),
    skipped: slotsOf(skipped),
    handAdded: rows.length - autopilotRows.length
  };
  const replaces = waiting.length + skipped.length;
  const mode = input.packExists ? "rewrite" : "write";

  let reason: string | null = null;
  if (started.length > 0) reason = input.autopilot?.noAccount ? REWRITE_STARTED_NO_ACCOUNT_REASON : REWRITE_STARTED_REASON;
  else if (failed.length > 0) reason = REWRITE_FAILED_REASON;
  else if (replaces > 0 && input.autopilot?.paused) {
    reason = "The autopilot is paused, so the posts already queued for today could not be swapped for the new pack. Resume it on Automations first.";
  } else if (replaces > 0 && input.autopilot?.blockedReason) {
    reason = `The posts already queued for today could not be swapped for the new pack: ${input.autopilot.blockedReason}`;
  }

  const confirm: string[] = [];
  if (!reason && mode === "rewrite") {
    const pack = input.pack;
    confirm.push(
      pack
        ? `This throws away today's pack (${plural(pack.posts, "post")}, ${plural(pack.replies, "reply", "replies")}) and writes a new one. The old pack is not kept.`
        : "This throws away today's pack and writes a new one. The old pack is not kept."
    );
    if (replaces > 0) {
      const parts = [
        counts.queued > 0
          ? `${plural(counts.queued, "queued post")}${counts.queuedSends !== counts.queued ? ` (${plural(counts.queuedSends, "send")} across accounts)` : ""}`
          : "",
        counts.skipped > 0 ? `${plural(counts.skipped, "skipped post")}` : ""
      ].filter(Boolean);
      confirm.push(
        `${parts.join(" and ")} for today ${counts.queued + counts.skipped === 1 ? "is" : "are"} replaced by the new pack's posts at the new pack's times. Any edits or time changes you made to them are lost, and a time that has already passed is left out rather than sent late.`
      );
    } else {
      confirm.push("Nothing is queued for today yet, so the autopilot plans from the new pack.");
    }
    confirm.push("Nothing from today has gone out, so nothing is duplicated. Once the first post goes out this button turns off - a sent post cannot be unsent.");
    if (counts.handAdded > 0) confirm.push(`${plural(counts.handAdded, "post")} you added by hand ${counts.handAdded === 1 ? "is" : "are"} not touched.`);
  }

  return { mode, allowed: reason === null, reason, counts, replaces, confirm };
}
