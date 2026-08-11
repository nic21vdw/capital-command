/**
 * One publish run at a time.
 *
 * The publish runner fires from Task Scheduler every five minutes and each tick
 * POSTs /api/publish/run. When a tick outlives its interval — a slow upload, a
 * retry storm, a second driver hitting the same endpoint — two runs overlap,
 * both read the same due items, and both upload them. The per-item claim in the
 * queue is a soft lease written after the read, so it does not close that
 * window on its own.
 *
 * The runs that matter share one Next.js process (Task Scheduler, the update
 * script and the UI all talk to the server on port 3000), so a process-wide
 * gate is enough. A sandbox on another port has its own data directory and is
 * meant to run independently.
 */

let active: Promise<unknown> | null = null;

export function publishRunInProgress(): boolean {
  return active !== null;
}

/**
 * Runs `work` unless a run is already in flight, in which case it returns
 * `null` immediately rather than queueing — a tick that arrives late is stale
 * by definition, and the next one is only five minutes away.
 */
export async function withPublishRunLock<T>(work: () => Promise<T>): Promise<T | null> {
  if (active) return null;
  const run = work();
  active = run;
  try {
    return await run;
  } finally {
    active = null;
  }
}
