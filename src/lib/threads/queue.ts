import { readFile } from "node:fs/promises";
import { THREADS_TEXT_LIMIT, threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { threadsAwaitingApproval, threadsUnsent, type ReviewPolicy } from "@/lib/publisher/approval";
import type { ThreadsBatchSummary, ThreadsQueueItem } from "@/lib/threads/types";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";
import { hasStarted } from "@/lib/threads/rewrite";

/**
 * The Threads autopilot queue: one JSON file of scheduled posts.
 *
 * Nothing is cached between calls — every mutation re-reads the file, changes
 * it, and writes it back through atomicWriteJson while holding a lock file
 * that other processes honour. That matters because two things touch this
 * queue: the app (the dashboard card, the tick route) and whatever the
 * scheduled task pokes. An in-memory copy in either one would quietly clobber
 * the other's writes, which is exactly the failure the Stream Pipeline had to
 * be redesigned around.
 */

const FILE_PATH = dataPath("threads-queue.json");

/** Serializes complete read-modify-writes made by this process. */
let writeChain: Promise<unknown> = Promise.resolve();

function withQueueWrite<T>(work: () => Promise<T>): Promise<T> {
  const locked = () => withFileLock(FILE_PATH, work);
  const pending = writeChain.then(locked, locked);
  writeChain = pending.catch(() => undefined);
  return pending;
}

export async function readQueue(): Promise<ThreadsQueueItem[]> {
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("The saved Threads queue must be a list of posts.");
    return parsed as ThreadsQueueItem[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("The Threads queue could not be read. Repair the saved queue before changing or posting its items.");
  }
}

async function saveQueue(items: ThreadsQueueItem[]): Promise<void> {
  const sorted = [...items].sort(
    (a, b) => a.publishAt.localeCompare(b.publishAt) || a.slot - b.slot || a.accountId.localeCompare(b.accountId)
  );
  await atomicWriteJson(FILE_PATH, sorted);
}

export async function writeQueue(items: ThreadsQueueItem[]): Promise<void> {
  await withQueueWrite(() => saveQueue(items));
}

/** Read-modify-write in one go, so callers never hold a stale copy. */
export async function mutateQueue<T>(
  change: (items: ThreadsQueueItem[]) => { items: ThreadsQueueItem[]; result: T }
): Promise<T> {
  return withQueueWrite(async () => {
    const { items, result } = change(await readQueue());
    await saveQueue(items);
    return result;
  });
}

/** Applies only a runner's changes over the latest queue, keeping edits made while it waited on Threads. */
export function mergeQueueChanges(
  before: ThreadsQueueItem[],
  after: ThreadsQueueItem[],
  current: ThreadsQueueItem[]
): ThreadsQueueItem[] {
  const previous = new Map(before.map((item) => [item.id, item]));
  const updated = new Map(after.map((item) => [item.id, item]));
  const merged: ThreadsQueueItem[] = [];
  for (const item of current) {
    const original = previous.get(item.id);
    const changed = updated.get(item.id);
    if (!original) {
      merged.push(item);
      continue;
    }
    if (!changed) {
      // Pruning may retire an old row only if nobody rescheduled/edited it.
      if (JSON.stringify(item) !== JSON.stringify(original)) merged.push(item);
      continue;
    }
    const next = { ...item };
    for (const key of new Set([...Object.keys(original), ...Object.keys(changed)]) as Set<keyof ThreadsQueueItem>) {
      if (JSON.stringify(original[key]) !== JSON.stringify(changed[key])) {
        Object.assign(next, { [key]: changed[key] });
      }
    }
    merged.push(next);
  }
  // A row removed by hand is absent from current and stays removed.
  for (const item of after) {
    if (!previous.has(item.id) && !current.some((entry) => entry.id === item.id)) merged.push(item);
  }
  return merged;
}

export function queuePath(): string {
  return FILE_PATH;
}

/** Drops batches older than the retention window so the file stays small. */
export function pruneOld(
  items: ThreadsQueueItem[],
  now: Date,
  config: ThreadsConfig = threadsConfig()
): ThreadsQueueItem[] {
  const cutoff = now.getTime() - config.retentionDays * 86_400_000;
  return items.filter((item) => new Date(item.publishAt).getTime() >= cutoff
    || (!item.postId && Boolean(item.publishAttemptedAt || item.containerId))
    || (!item.plugPostId && Boolean(item.plugPublishAttemptedAt || item.plugContainerId)));
}

export function hasBatch(items: ThreadsQueueItem[], date: string): boolean {
  return items.some((item) => item.batchDate === date);
}

export function itemsForDate(items: ThreadsQueueItem[], date: string): ThreadsQueueItem[] {
  return items.filter((item) => item.batchDate === date);
}

/** Everything the autopilot itself planned — see `ThreadsQueueItem.origin`. */
export function isAutopilotItem(item: ThreadsQueueItem): boolean {
  return item.origin !== "pipeline";
}

/**
 * What the autopilot must look at when it asks "is this day planned yet?".
 * Counting a post added from a stream would make it skip the day's pack, and
 * the whole point of the daily batch is that it always gets written.
 */
export function autopilotItemsForDate(items: ThreadsQueueItem[], date: string): ThreadsQueueItem[] {
  return itemsForDate(items, date).filter(isAutopilotItem);
}

function tally(items: ThreadsQueueItem[]) {
  return {
    total: items.length,
    published: items.filter((item) => item.status === "published").length,
    pending: items.filter((item) => item.status === "pending").length,
    failed: items.filter((item) => item.status === "failed").length,
    skipped: items.filter((item) => item.status === "skipped").length
  };
}

export function summarizeBatch(items: ThreadsQueueItem[], date: string): ThreadsBatchSummary {
  const forDate = itemsForDate(items, date);
  const next = forDate
    .filter((item) => item.status === "pending")
    .map((item) => item.publishAt)
    .sort((a, b) => a.localeCompare(b))
    .find(Boolean);
  const accountIds = [...new Set(forDate.map((item) => item.accountId))].sort();
  return {
    date,
    ...tally(forDate),
    nextAt: next,
    accounts: accountIds.map((accountId) => ({
      accountId,
      ...tally(forDate.filter((item) => item.accountId === accountId))
    }))
  };
}

/** Every batch present in the queue, newest day first. */
export function summarizeBatches(items: ThreadsQueueItem[]): ThreadsBatchSummary[] {
  const dates = [...new Set(items.map((item) => item.batchDate))].sort((a, b) => b.localeCompare(a));
  return dates.map((date) => summarizeBatch(items, date));
}

/**
 * Editing what is queued. All pure over the item list, so the rules — only a
 * pending post can be changed, a published one is history — are testable
 * without touching a file or the network.
 */

export type QueueEditResult = { items: ThreadsQueueItem[]; changed: number; error?: string };

function editable(item: ThreadsQueueItem): boolean {
  return item.status === "pending";
}

/**
 * Statuses a post can come back from. A published post is history, but a
 * failed or skipped one never reached Threads, so its copy is still yours to
 * fix and send.
 */
function recoverable(item: ThreadsQueueItem): boolean {
  return item.status === "failed" || item.status === "skipped";
}

/** Moves one queued post to a new time. */
export function rescheduleItem(items: ThreadsQueueItem[], id: string, publishAt: string): QueueEditResult {
  const target = items.find((item) => item.id === id);
  if (!target) return { items, changed: 0, error: "No such queued post." };
  if (!editable(target)) return { items, changed: 0, error: `That post is already ${target.status}.` };
  if (hasStarted(target)) return { items, changed: 0, error: "This post has already started sending. Its scheduled time cannot be changed during delivery." };
  if (Number.isNaN(new Date(publishAt).getTime())) return { items, changed: 0, error: "That isn't a valid time." };

  target.publishAt = new Date(publishAt).toISOString();
  // Only an unstarted post can move. Clear its backoff for the new time,
  // while a delivery claim remains protected by the guard above.
  delete target.nextAttemptAt;
  return { items, changed: 1 };
}

/** Shifts unstarted pending posts of a day, retaining every delivery claim. */
export function shiftBatch(items: ThreadsQueueItem[], date: string, minutes: number): QueueEditResult {
  if (!Number.isFinite(minutes) || minutes === 0) {
    return { items, changed: 0, error: "Give a non-zero number of minutes." };
  }
  const waiting = items.filter((item) => item.batchDate === date && editable(item));
  const pending = waiting.filter((item) => !hasStarted(item));
  if (pending.length === 0) return { items, changed: 0, error: waiting.length
    ? "The pending posts on that day have already started sending and cannot be moved."
    : "Nothing pending on that day to move." };

  for (const item of pending) {
    item.publishAt = new Date(new Date(item.publishAt).getTime() + minutes * 60_000).toISOString();
    delete item.nextAttemptAt;
  }
  return { items, changed: pending.length };
}

/**
 * Puts a failed (or skipped) post back in the running. A post that never went
 * out is the copy you already approved, so recovering it must not mean typing
 * it again — but its slot has passed, and the runner skips anything more than
 * the grace period late. So the retry lands it at `now`, which is exactly what
 * "post this one now" means, and clears the state that failure left behind.
 */
export function retryItem(items: ThreadsQueueItem[], id: string, now: Date): QueueEditResult {
  const target = items.find((item) => item.id === id);
  if (!target) return { items, changed: 0, error: "No such queued post." };
  if (!recoverable(target)) {
    return { items, changed: 0, error: `That post is ${target.status} — there is nothing to retry.` };
  }
  // It carries a Threads post id, so it went live even though the queue ended
  // up recording a failure. Sending it again would post the same thing twice.
  if (!target.postId && (target.publishAttemptedAt || (target.containerId && !target.containerPreparedAt))) {
    return { items, changed: 0, error: "This publish outcome is unknown. Check Threads and reconcile its receipt before retrying." };
  }
  if (target.postId) {
    return { items, changed: 0, error: "That post already reached Threads, so it won't be sent again." };
  }

  target.status = "pending";
  if (target.attempts > 0 || target.lastFailedAt) target.approvedAt ??= now.toISOString();
  target.attempts = 0;
  if (new Date(target.publishAt).getTime() < now.getTime()) target.publishAt = now.toISOString();
  delete target.error;
  delete target.note;
  delete target.nextAttemptAt;
  delete target.claimedAt;
  return { items, changed: 1 };
}

/** Rewrites the copy of one queued post. */
export function editItemText(items: ThreadsQueueItem[], id: string, text: string): QueueEditResult {
  const trimmed = text.trim();
  if (!trimmed) return { items, changed: 0, error: "A post can't be empty." };
  const target = items.find((item) => item.id === id);
  if (!target) return { items, changed: 0, error: "No such queued post." };
  // A failed post is edited on the way to being retried, so its copy stays
  // open even though it is out of the running until then.
  if (!editable(target) && !recoverable(target)) {
    return { items, changed: 0, error: `That post is already ${target.status}.` };
  }
  if (target.postId || target.containerId || target.claimedAt || target.publishAttemptedAt) {
    return { items, changed: 0, error: "This post has already started sending. Its saved copy cannot be changed during delivery." };
  }

  target.text = trimmed.slice(0, THREADS_TEXT_LIMIT);
  if (!target.plugPostId && !target.plugContainerId && !(target.plugAttempts ?? 0)) {
    // The contextual follow-up is generated from the revised parent before
    // delivery. An already-started reply retains its identity and copy.
    delete target.plugText;
  }
  return { items, changed: 1 };
}

export function approveItems(
  items: ThreadsQueueItem[],
  filter: { id?: string; ids?: string[] },
  now: Date,
  policy?: ReviewPolicy
): QueueEditResult {
  if (filter.id !== undefined) {
    const target = items.find((item) => item.id === filter.id);
    if (!target) return { items, changed: 0, error: "No such queued post." };
    if (!threadsUnsent(target)) return { items, changed: 0, error: `That post is already ${target.status}.` };
    if (target.approvedAt) return { items, changed: 0 };
    target.approvedAt = now.toISOString();
    return { items, changed: 1 };
  }
  const named = new Set(filter.ids ?? []);
  const waiting = items.filter(
    (item) => named.has(item.id) && (policy ? threadsAwaitingApproval(item, policy) : threadsUnsent(item) && !item.approvedAt)
  );
  for (const item of waiting) item.approvedAt = now.toISOString();
  return { items, changed: waiting.length };
}
