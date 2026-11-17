import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { PipelineRun } from "@/lib/pipeline/types";
import type { QueueItem } from "@/lib/publisher/types";

// Which finished Shorts are waiting for a decision. One answer for the
// publisher card and the weekly review sheet, so they never disagree.
//
// A clip is READY only when its post-ready file exists: the Clip Editor export
// (`editedFile`) or the 9:16 render (`downloadFile`). The neutral 16:9 master
// (`file`) is not something anyone posts. A job that is still rendering has
// some ready clips and some not; only the ready ones count.
//
// A clip is BOOKED when a short video item in the queue is that clip's file
// from that job. A carousel or the long-form edit of the same run books
// nothing here: they are other outputs.
//
// A clip is DECIDED when the run remembers a choice about it: unticked at a
// booking sheet (`queueHeldBack`) or booked and later pulled (`queueBooked`).
// The pipeline's own sheet keys those by the same `clip:<job>:<clip>` id.
// Pure: callers hand in runs, jobs and the queue.

export const BACKLOG_LOOKBACK_DAYS = 21;
const DAY_MS = 86_400_000;

export type BacklogClip = {
  candidateId: string;
  runId: string;
  runName: string;
  jobId: string;
  clipId: string;
  title: string;
  score: number;
  durationSec: number;
  file: string;
  posterFile?: string;
  framing?: string;
  hookQuote?: string;
};

export type RunBacklog = {
  runId: string;
  runName: string;
  createdAt: string;
  ready: number;
  booked: number;
  decided: number;
  waiting: BacklogClip[];
};

export function clipCandidateId(jobId: string, clipId: string): string {
  return `clip:${jobId}:${clipId}`;
}

/** The file a finished clip would post, or nothing while it is unfinished. */
export function readyFile(clip: Pick<ClipCandidate, "editedFile" | "downloadFile">): string | undefined {
  return clip.editedFile ?? clip.downloadFile;
}

function baseName(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/** Short video files already in the queue, by job id, as lower-case file names. */
export function bookedClipFiles(queue: QueueItem[]): Map<string, Set<string>> {
  const byJob = new Map<string, Set<string>>();
  const add = (jobId: string, value: string) => {
    const set = byJob.get(jobId) ?? new Set<string>();
    set.add(baseName(value));
    byJob.set(jobId, set);
  };
  for (const item of queue) {
    if (item.mediaKind === "image" || item.format === "long") continue;
    for (const value of [item.clipPath, item.sourceClipPath]) {
      if (!value) continue;
      if (item.jobId) add(item.jobId, value);
      const segments = value.replace(/\\/g, "/").split("/");
      const outputs = segments.lastIndexOf("outputs");
      if (outputs >= 0 && segments[outputs + 1]) add(segments[outputs + 1], value);
    }
  }
  return byJob;
}

function isBooked(clip: ClipCandidate, jobId: string, booked: Map<string, Set<string>>): boolean {
  const files = booked.get(jobId);
  if (!files) return false;
  return [clip.editedFile, clip.downloadFile, clip.file].some((name) => name && files.has(baseName(name)));
}

export function runBacklog(
  runs: PipelineRun[],
  jobs: ClipJob[],
  queue: QueueItem[],
  now: Date,
  lookbackDays = BACKLOG_LOOKBACK_DAYS
): RunBacklog[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const booked = bookedClipFiles(queue);
  const since = now.getTime() - lookbackDays * DAY_MS;
  const out: RunBacklog[] = [];
  for (const run of runs) {
    if (!run.clipJobId || run.status === "draft" || run.marketingSource) continue;
    if (!(Date.parse(run.createdAt) >= since)) continue;
    const job = jobsById.get(run.clipJobId);
    if (!job) continue;
    const decided = new Set([...(run.queueHeldBack ?? []), ...(run.queueBooked ?? [])]);
    const entry: RunBacklog = { runId: run.id, runName: run.name, createdAt: run.createdAt, ready: 0, booked: 0, decided: 0, waiting: [] };
    for (const clip of job.clips) {
      const file = readyFile(clip);
      if (!file) continue;
      entry.ready += 1;
      if (isBooked(clip, job.id, booked)) {
        entry.booked += 1;
        continue;
      }
      const candidateId = clipCandidateId(job.id, clip.id);
      if (decided.has(candidateId)) {
        entry.decided += 1;
        continue;
      }
      entry.waiting.push({
        candidateId,
        runId: run.id,
        runName: run.name,
        jobId: job.id,
        clipId: clip.id,
        title: clip.title?.trim() || `Clip ${clip.id}`,
        score: Number.isFinite(clip.score) ? clip.score : 0,
        durationSec: Math.max(0, Math.round((clip.end - clip.start) * 10) / 10),
        file,
        ...(clip.posterFile ? { posterFile: clip.posterFile } : {}),
        ...(clip.framing?.mode ? { framing: clip.framing.mode } : {}),
        ...(clip.hookQuote ? { hookQuote: clip.hookQuote } : {})
      });
    }
    if (entry.ready > 0) out.push(entry);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Every waiting clip across runs, strongest first; ties keep the newer stream first. */
export function waitingClips(backlog: RunBacklog[]): BacklogClip[] {
  const order = new Map(backlog.map((run, index) => [run.runId, index]));
  return backlog
    .flatMap((run) => run.waiting)
    .sort((a, b) => b.score - a.score || (order.get(b.runId) ?? 0) - (order.get(a.runId) ?? 0) || a.clipId.localeCompare(b.clipId));
}

/**
 * His picks, by run, checked against what is waiting NOW. A pick that is no
 * longer waiting (booked a moment ago, decided on the pipeline sheet, or never
 * a finished Short) is returned as `stale`, never booked: that is what makes a
 * repeated or retried confirmation a no-op instead of a second booking.
 */
export function groupPicks(picks: string[], waiting: BacklogClip[]): { byRun: Map<string, string[]>; stale: string[] } {
  const known = new Map(waiting.map((clip) => [clip.candidateId, clip.runId]));
  const byRun = new Map<string, string[]>();
  const stale: string[] = [];
  for (const id of new Set(picks)) {
    const runId = known.get(id);
    if (!runId) {
      stale.push(id);
      continue;
    }
    byRun.set(runId, [...(byRun.get(runId) ?? []), id]);
  }
  return { byRun, stale };
}
