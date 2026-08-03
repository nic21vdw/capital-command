import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { THREADS_TEXT_LIMIT, threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsBatchSummary, ThreadsQueueItem } from "@/lib/threads/types";
import { dataPath } from "@/lib/paths";

/**
 * The Threads autopilot queue: one JSON file of scheduled posts.
 *
 * Nothing is cached between calls — every mutation re-reads the file, changes
 * it, and writes it back through a temp file + rename. That matters because
 * two things touch this queue: the app (the dashboard card, the tick route)
 * and whatever the scheduled task pokes. An in-memory copy in either one would
 * quietly clobber the other's writes, which is exactly the failure the Stream
 * Pipeline had to be redesigned around.
 */

const FILE_PATH = dataPath("threads-queue.json");

/** Serializes writes made by this process; the rename makes each one atomic. */
let writeChain: Promise<unknown> = Promise.resolve();

export async function readQueue(): Promise<ThreadsQueueItem[]> {
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ThreadsQueueItem[]) : [];
  } catch {
    return [];
  }
}

export async function writeQueue(items: ThreadsQueueItem[]): Promise<void> {
  const sorted = [...items].sort(
    (a, b) => a.publishAt.localeCompare(b.publishAt) || a.slot - b.slot || a.accountId.localeCompare(b.accountId)
  );
  const write = async () => {
    await mkdir(path.dirname(FILE_PATH), { recursive: true });
    const tmpPath = `${FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(sorted, null, 2), "utf8");
    await rename(tmpPath, FILE_PATH);
  };
  writeChain = writeChain.then(write, write);
  await writeChain;
}

/** Read-modify-write in one go, so callers never hold a stale copy. */
export async function mutateQueue<T>(
  change: (items: ThreadsQueueItem[]) => { items: ThreadsQueueItem[]; result: T }
): Promise<T> {
  const { items, result } = change(await readQueue());
  await writeQueue(items);
  return result;
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
  return items.filter((item) => new Date(item.publishAt).getTime() >= cutoff);
}

export function hasBatch(items: ThreadsQueueItem[], date: string): boolean {
  return items.some((item) => item.batchDate === date);
}

export function itemsForDate(items: ThreadsQueueItem[], date: string): ThreadsQueueItem[] {
  return items.filter((item) => item.batchDate === date);
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

/** Moves one queued post to a new time. */
export function rescheduleItem(items: ThreadsQueueItem[], id: string, publishAt: string): QueueEditResult {
  const target = items.find((item) => item.id === id);
  if (!target) return { items, changed: 0, error: "No such queued post." };
  if (!editable(target)) return { items, changed: 0, error: `That post is already ${target.status}.` };
  if (Number.isNaN(new Date(publishAt).getTime())) return { items, changed: 0, error: "That isn't a valid time." };

  target.publishAt = new Date(publishAt).toISOString();
  // A post that was backed off or half-claimed gets a clean slate at its new
  // time, or the runner would keep honouring gates set for the old one.
  delete target.nextAttemptAt;
  delete target.claimedAt;
  return { items, changed: 1 };
}

/** Shifts every still-pending post of a day by the given minutes. */
export function shiftBatch(items: ThreadsQueueItem[], date: string, minutes: number): QueueEditResult {
  if (!Number.isFinite(minutes) || minutes === 0) {
    return { items, changed: 0, error: "Give a non-zero number of minutes." };
  }
  const pending = items.filter((item) => item.batchDate === date && editable(item));
  if (pending.length === 0) return { items, changed: 0, error: "Nothing pending on that day to move." };

  for (const item of pending) {
    item.publishAt = new Date(new Date(item.publishAt).getTime() + minutes * 60_000).toISOString();
    delete item.nextAttemptAt;
    delete item.claimedAt;
  }
  return { items, changed: pending.length };
}

/** Rewrites the copy of one queued post. */
export function editItemText(items: ThreadsQueueItem[], id: string, text: string): QueueEditResult {
  const trimmed = text.trim();
  if (!trimmed) return { items, changed: 0, error: "A post can't be empty." };
  const target = items.find((item) => item.id === id);
  if (!target) return { items, changed: 0, error: "No such queued post." };
  if (!editable(target)) return { items, changed: 0, error: `That post is already ${target.status}.` };

  target.text = trimmed.slice(0, THREADS_TEXT_LIMIT);
  return { items, changed: 1 };
}
