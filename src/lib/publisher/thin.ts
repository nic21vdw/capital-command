import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { localDateKey } from "@/lib/publisher/schedule";
import { isShortFormItem } from "@/lib/publisher/shortsCap";
import type { QueueItem } from "@/lib/publisher/types";

export const REQUIRED_BUILD_COMMIT = "ea9f436";

export type ParkedEntry = { parkedAt: string; reason: string; item: QueueItem };
export type ParkedFile = { parked: ParkedEntry[] };

export type ThinDay = {
  day: string;
  before: number;
  after: number;
  locked: number;
  kept: string[];
  parked: string[];
};

export type ThinPlan = { limit: number; days: ThinDay[]; park: QueueItem[] };

type ClipJobLike = { id: string; clips?: Array<{ score?: number; file?: string; downloadFile?: string; editedFile?: string }> };

const fileKey = (jobId: string, file: string) => `${jobId}|${path.win32.basename(file).toLowerCase()}`;

export function clipScoreIndex(jobs: ClipJobLike[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const job of jobs) {
    for (const clip of job.clips ?? []) {
      if (typeof clip.score !== "number") continue;
      for (const file of [clip.file, clip.downloadFile, clip.editedFile]) {
        if (file) index.set(fileKey(job.id, file), clip.score);
      }
    }
  }
  return index;
}

export function clipScore(item: QueueItem, scores: Map<string, number>): number | undefined {
  if (!item.jobId) return undefined;
  for (const file of [item.clipPath, item.sourceClipPath]) {
    const score = file ? scores.get(fileKey(item.jobId, file)) : undefined;
    if (score !== undefined) return score;
  }
  return undefined;
}

export function isLockedItem(item: QueueItem): boolean {
  const platforms = Object.values(item.platforms ?? {});
  const platformStarted = platforms.some(
    (state) =>
      state &&
      (state.status === "published" ||
        state.status === "scheduled" ||
        state.status === "uploaded" ||
        Boolean(state.postId) ||
        Boolean(state.containerId) ||
        Boolean(state.claimedAt))
  );
  const bufferStarted = Boolean(
    item.buffer && (item.buffer.status === "scheduled" || item.buffer.status === "published" || item.buffer.updateIds?.length)
  );
  return platformStarted || bufferStarted;
}

export function planThin(
  items: QueueItem[],
  options: { now: Date; timeZone: string; limit: number; scores?: Map<string, number> }
): ThinPlan {
  const { now, timeZone, limit } = options;
  const scores = options.scores ?? new Map<string, number>();
  const byDay = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (!isShortFormItem(item)) continue;
    const day = localDateKey(item.publishAt, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }

  const days: ThinDay[] = [];
  const park: QueueItem[] = [];
  const today = localDateKey(now, timeZone);
  for (const day of [...byDay.keys()].sort()) {
    if (day < today) continue;
    const shorts = byDay.get(day)!;
    const fixed = shorts.filter((item) => isLockedItem(item) || new Date(item.publishAt).getTime() <= now.getTime());
    const movable = shorts
      .filter((item) => !fixed.includes(item))
      .sort((a, b) => {
        const scoreA = clipScore(a, scores) ?? Number.NEGATIVE_INFINITY;
        const scoreB = clipScore(b, scores) ?? Number.NEGATIVE_INFINITY;
        return scoreB - scoreA || a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id);
      });
    const room = Math.max(0, limit - fixed.length);
    const kept = movable.slice(0, room);
    const parked = movable.slice(room);
    park.push(...parked);
    days.push({
      day,
      before: shorts.length,
      after: shorts.length - parked.length,
      locked: fixed.length,
      kept: kept.map((item) => item.id),
      parked: parked.map((item) => item.id)
    });
  }
  return { limit, days, park };
}

export function defaultParkedPath(queuePath: string): string {
  return path.join(path.dirname(queuePath), "publish-queue.parked.json");
}

export async function readParked(file: string): Promise<ParkedFile> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<ParkedFile>;
    return { parked: Array.isArray(parsed.parked) ? parsed.parked : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { parked: [] };
    throw error;
  }
}

export function planUnpark(
  parked: ParkedFile,
  liveIds: Set<string>,
  options: { now: Date; ids?: string[] }
): { restore: QueueItem[]; stay: ParkedEntry[]; skipped: Array<{ id: string; reason: string }> } {
  const restore: QueueItem[] = [];
  const stay: ParkedEntry[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const entry of parked.parked) {
    const wanted = !options.ids?.length || options.ids.includes(entry.item.id);
    if (!wanted) {
      stay.push(entry);
    } else if (liveIds.has(entry.item.id)) {
      skipped.push({ id: entry.item.id, reason: "already on the queue" });
    } else if (new Date(entry.item.publishAt).getTime() <= options.now.getTime()) {
      skipped.push({ id: entry.item.id, reason: "its time has passed; left parked so it is not posted late" });
      stay.push(entry);
    } else {
      restore.push(entry.item);
    }
  }
  return { restore, stay, skipped };
}

export function buildGate(
  cwd: string,
  run: (command: string, args: string[], cwd: string) => void = (command, args, where) => {
    execFileSync(command, args, { cwd: where, stdio: "ignore" });
  },
  readBuild: (file: string) => string | null = (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
): { ok: true; build: string } | { ok: false; reason: string } {
  const build = readBuild(path.join(cwd, ".next", "BUILD_COMMIT"))?.trim();
  if (!build) {
    return { ok: false, reason: "There is no .next/BUILD_COMMIT, so there is no way to tell whether the running server reloads the queue." };
  }
  try {
    run("git", ["merge-base", "--is-ancestor", REQUIRED_BUILD_COMMIT, build], cwd);
    return { ok: true, build };
  } catch {
    return {
      ok: false,
      reason: `The running build (${build.slice(0, 7)}) does not contain ${REQUIRED_BUILD_COMMIT}, so the server still holds its own copy of the queue and would write parked posts back. Release first, then run this again.`
    };
  }
}
