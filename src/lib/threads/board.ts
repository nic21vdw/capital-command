import type { ThreadsQueueItem } from "@/lib/threads/types";

/**
 * How the "Scheduled & sent" board labels itself. Pure, so the two rules that
 * went wrong on screen are tested:
 *
 * - It opened on TOMORROW's batch, because the pills are sorted newest first and
 *   the first one was taken. It opens on today (or ?date=) unless the person
 *   has picked a pill.
 * - Posts were numbered by their pack slot, so with two accounts every number
 *   showed twice, a hand-added post was "0" and a day that skipped a slot read
 *   "1, 1, 2, 4, 4". A post is now numbered 1..N in the order it goes out, once,
 *   whichever accounts send it.
 */

/** Which day the board shows: the person's pick, else ?date=, else today, else the nearest day there is. */
export function defaultBatchDate(input: {
  dates: string[];
  today: string;
  picked?: string | null;
  requested?: string | null;
}): string {
  const { dates, today } = input;
  for (const candidate of [input.picked, input.requested, today]) {
    if (candidate && dates.includes(candidate)) return candidate;
  }
  const ascending = [...dates].sort();
  const earlier = ascending.filter((date) => date <= today);
  if (earlier.length > 0) return earlier[earlier.length - 1];
  return ascending[0] ?? today;
}

type Row = Pick<ThreadsQueueItem, "id" | "slot" | "origin" | "publishAt">;

/** Row id -> the number of the post it belongs to (1..N, in sending order). */
export function numberBatchPosts(items: Row[]): Map<string, number> {
  const groups = new Map<string, { at: number; ids: string[] }>();
  for (const item of items) {
    // A stream or hand-added post carries its own slot numbering: it is one post.
    const key = item.origin === "pipeline" ? `pipeline:${item.id}` : `slot:${item.slot}`;
    const at = Date.parse(item.publishAt);
    const group = groups.get(key) ?? { at: Number.POSITIVE_INFINITY, ids: [] };
    group.at = Math.min(group.at, Number.isFinite(at) ? at : Number.POSITIVE_INFINITY);
    group.ids.push(item.id);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]));
  const numbers = new Map<string, number>();
  ordered.forEach(([, group], index) => group.ids.forEach((id) => numbers.set(id, index + 1)));
  return numbers;
}
