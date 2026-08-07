import { advanceMusicJob, listMusicJobs } from "@/lib/music/jobs";
import { queueReadyOutputs, stopQueueingWhenSettled } from "@/lib/pipeline/queueOutputs";
import { recordQueueFailure } from "@/lib/pipeline/queueOutputs";
import { queueRunPosts } from "@/lib/pipeline/queuePosts";
import { listRuns, overviewContext, runOverview } from "@/lib/pipeline/runs";

// Polling the overview is what advances a run, and until now the only thing
// polling was an open browser tab. A stream started at 11pm froze the moment
// the tab was closed and did not move again until something opened the app.
// The server ticks it itself now — same call the page makes, in the same
// process that owns the run map, so nothing about ownership changes.

const INTERVAL_MS = 90_000;
const FIRST_TICK_MS = 8_000;

type HeartbeatGlobal = typeof globalThis & { __pipelineHeartbeat?: NodeJS.Timeout };
const g = globalThis as HeartbeatGlobal;

/**
 * A music generation is paid for at submission and only imported by the poll
 * that first sees it finished — so a closed tab stranded a track that had
 * already been bought. Advancing it here costs one status read per pending job.
 */
async function advanceMusicOnce(): Promise<number> {
  const jobs = await listMusicJobs().catch(() => []);
  const pending = jobs.filter((job) => job.status === "pending");
  for (const job of pending) {
    await advanceMusicJob(job.requestId).catch(() => undefined);
  }
  return pending.length;
}

export async function advancePipelineOnce(): Promise<number> {
  const runs = await listRuns();
  const live = runs.filter((run) => run.status === "running" || run.status === "ingesting");
  if (live.length === 0) return 0;
  const context = overviewContext();
  const settledNow: string[] = [];
  for (const run of live) {
    const overview = await runOverview(run, context).catch(() => undefined);
    if (overview?.settled) settledNow.push(run.id);
  }
  // Drain BEFORE ending the standing instruction. The tick that settles a run
  // is the tick its last export finished on — stopping first meant the final
  // segment was the one output never booked.
  await queueReadyOutputs().catch(() => undefined);
  await queueUnattendedPosts(live).catch(() => undefined);
  for (const runId of settledNow) {
    await stopQueueingWhenSettled(runId, true).catch(() => undefined);
  }
  return live.length;
}

/**
 * The text posts of a run nobody was watching. They are written hours after the
 * scan started, so the same standing instruction that books the videos has to
 * cover them — `postsQueuedAt` is what keeps it to once.
 */
async function queueUnattendedPosts(runs: { id: string; unattended?: boolean; posts?: unknown[]; postsQueuedAt?: string }[]) {
  for (const run of runs) {
    if (!run.unattended || run.postsQueuedAt || !(run.posts?.length ?? 0)) continue;
    try {
      await queueRunPosts(run.id);
    } catch (error) {
      // Swallowing this retried the same impossible call every tick forever and
      // told him nothing — the same hole the video booking had.
      await recordQueueFailure(run.id, "Text posts", error instanceof Error ? error.message : String(error));
    }
  }
}

/** Idempotent: a hot reload must not leave two timers ticking the same runs. */
export function startPipelineHeartbeat() {
  if (g.__pipelineHeartbeat) return;
  const tick = () => {
    void advancePipelineOnce().catch(() => undefined);
    void advanceMusicOnce().catch(() => undefined);
  };
  g.__pipelineHeartbeat = setInterval(tick, INTERVAL_MS);
  g.__pipelineHeartbeat.unref?.();
  setTimeout(tick, FIRST_TICK_MS).unref?.();
}
