import { planAdhocPosts } from "@/lib/threads/adhoc";
import { THREADS_TEXT_LIMIT, threadsBlockedReason, type ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";

/**
 * "Add a post": one hand-written Threads post onto the queue the autopilot
 * already drains. It rides the same runner and the same pause switch as the
 * generated posts, and lands outside the daily pack's numbered slots (see
 * planAdhocPosts), so it never makes the autopilot think a day is planned.
 */

/** How far ahead a hand-written post may be booked. */
export const ADD_POST_MAX_DAYS = 60;
const MINUTE = 60_000;

export type AddPostResult = { ok: true; item: ThreadsQueueItem } | { ok: false; error: string };

export function planAddedPost(input: {
  text: string | undefined;
  /** ISO instant to post at; omitted means the default lead (about two hours from now). */
  at?: string;
  config: ThreadsConfig;
  now: Date;
  taken: Set<string>;
  newId?: () => string;
}): AddPostResult {
  const text = input.text?.trim() ?? "";
  if (!text) return { ok: false, error: "Write the post first." };
  if (text.length > THREADS_TEXT_LIMIT) {
    return { ok: false, error: `That is ${text.length} characters; Threads allows ${THREADS_TEXT_LIMIT}. Shorten it by ${text.length - THREADS_TEXT_LIMIT}.` };
  }
  const blocked = threadsBlockedReason(input.config);
  if (blocked) return { ok: false, error: blocked };

  let startAt: Date | undefined;
  if (input.at !== undefined) {
    startAt = new Date(input.at);
    if (!Number.isFinite(startAt.getTime())) return { ok: false, error: "That time is not valid." };
    if (startAt.getTime() < input.now.getTime() + MINUTE) return { ok: false, error: "Pick a time at least a minute from now." };
    if (startAt.getTime() > input.now.getTime() + ADD_POST_MAX_DAYS * 24 * 60 * MINUTE) {
      return { ok: false, error: `Pick a time within the next ${ADD_POST_MAX_DAYS} days.` };
    }
  }
  const [item] = planAdhocPosts({ texts: [text], config: input.config, now: input.now, taken: input.taken, startAt, newId: input.newId });
  if (!item) return { ok: false, error: "That post came out empty once cleaned up. Check the wording." };
  return { ok: true, item: { ...item, approvedAt: input.now.toISOString() } };
}
