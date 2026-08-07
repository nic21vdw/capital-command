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

export async function advancePipelineOnce(): Promise<number> {
  const runs = await listRuns();
  const live = runs.filter((run) => run.status === "running" || run.status === "ingesting");
  if (live.length === 0) return 0;
  const context = overviewContext();
  for (const run of live) {
    await runOverview(run, context).catch(() => undefined);
  }
  return live.length;
}

/** Idempotent: a hot reload must not leave two timers ticking the same runs. */
export function startPipelineHeartbeat() {
  if (g.__pipelineHeartbeat) return;
  const tick = () => void advancePipelineOnce().catch(() => undefined);
  g.__pipelineHeartbeat = setInterval(tick, INTERVAL_MS);
  g.__pipelineHeartbeat.unref?.();
  setTimeout(tick, FIRST_TICK_MS).unref?.();
}
