import { appendFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";

/**
 * Who wrote the publish queue, and when.
 *
 * One night 27 carousel items appeared on the live queue pointing at a
 * DIRECTORY, no pipeline run admitted to booking them, and there was no way to
 * find out who had — the queue file records what is scheduled and nothing about
 * how it got there. The same night a second agent ran the publish CLI straight
 * at the production folder and rewrote ~306 publish times. Neither question was
 * answerable, and an unanswerable question about the live queue is worse than
 * the bug itself: nothing can be ruled out.
 *
 * So every mutation appends one JSON line here: the moment, the process that
 * did it (`pid`, `cwd` — the working directory IS which checkout, because every
 * data path resolves from it), the item, its file, and the entry point.
 *
 * The entry point is THREADED, never guessed. A stack trace would name whatever
 * wrapper happened to be innermost and would go stale the first time a call
 * site moved; a label passed down from `enqueue`, the CLI's `mirror` / `adopt`
 * / `shuffle`, the API routes and the runner says what a person actually ran.
 *
 * Two properties this file must keep:
 *
 * - IT NEVER THROWS INTO THE CALLER. A failed audit write is a lost line, not a
 *   lost post. Everything below is wrapped and swallowed to a console warning.
 * - IT IS BOUNDED. The queue is written on every claim, retry and slot change,
 *   so an unbounded log is a data folder that grows forever. One rotation to
 *   `.1` at `MAX_LOG_BYTES` keeps at most two files and the recent past, which
 *   is the window any of this is asked about in.
 */

export type QueueWriter =
  | "enqueue"
  | "enqueue-image"
  | "pipeline-queue-outputs"
  | "api-publish-rename"
  | "api-publish-delete"
  | "api-publish-purge"
  | "cli-mirror"
  | "cli-mirror-reset"
  | "cli-retitle"
  | "cli-remove"
  | "cli-shuffle"
  | "cli-adopt"
  | "runner-mirror"
  | "adopt-channel-videos"
  | "unattributed";

export type QueueAction = "add" | "remove" | "publish-time" | "purge";

export type QueueAuditEntry = {
  at: string;
  pid: number;
  cwd: string;
  action: QueueAction;
  writer: QueueWriter;
  id: string;
  clipPath?: string;
  publishAt?: string;
};

/** Rotated, not truncated, so the line before a bad write survives it. */
export const MAX_LOG_BYTES = 2_000_000;

export function auditLogPath(): string {
  return dataPath("publish-queue.log");
}

/**
 * Keeps the log to two files at most. Checked before the append rather than
 * after, so the file that is currently being written is always the small one.
 */
async function rotateIfFull(file: string): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (!info || info.size < MAX_LOG_BYTES) return;
  await rename(file, `${file}.1`);
}

export function auditLine(entry: Omit<QueueAuditEntry, "at" | "pid" | "cwd">): QueueAuditEntry {
  return {
    at: new Date().toISOString(),
    pid: process.pid,
    cwd: process.cwd(),
    ...entry
  };
}

/**
 * Appends one line per mutation. Callers pass a batch (a shuffle moves hundreds
 * of times at once) so a bulk change costs one open, not one per item.
 */
export async function recordQueueMutations(
  entries: Array<Omit<QueueAuditEntry, "at" | "pid" | "cwd">>
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const file = auditLogPath();
    await rotateIfFull(file);
    const body = entries.map((entry) => JSON.stringify(auditLine(entry))).join("\n");
    await appendFile(file, `${body}\n`, "utf8");
  } catch (error) {
    console.warn(
      `[publisher] could not write ${path.basename(auditLogPath())}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function recordQueueMutation(entry: Omit<QueueAuditEntry, "at" | "pid" | "cwd">): Promise<void> {
  await recordQueueMutations([entry]);
}

/** Reads the log back, newest last, skipping any line a crash left half-written. */
export async function readQueueAudit(): Promise<QueueAuditEntry[]> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(auditLogPath(), "utf8").catch(() => "");
  const entries: QueueAuditEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as QueueAuditEntry);
    } catch {
      continue;
    }
  }
  return entries;
}
