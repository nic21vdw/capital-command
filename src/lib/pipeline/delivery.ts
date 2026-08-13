import type { PlatformState, QueueItem } from "@/lib/publisher/types";

/**
 * How much of a run has actually left the building.
 *
 * A run being "finished" only ever meant the files exist. Whether they were
 * booked, whether the platforms took them, and whether anything is live is a
 * different question, and the answer lives in the publish queue — so it is read
 * once per poll and joined back onto the runs here.
 */
export type RunDelivery = {
  /** Posts in the queue that came out of this run. */
  booked: number;
  /** Of those, live on at least one platform. */
  posted: number;
  /** With the bytes accepted but not yet live (YouTube publishAt, IG container). */
  uploading: number;
  /** Every platform on the post permanently failed. */
  failed: number;
  /** The earliest slot still to come, when one is left. */
  nextAt?: string;
};

const EMPTY: RunDelivery = { booked: 0, posted: 0, uploading: 0, failed: 0 };

function states(item: QueueItem): PlatformState[] {
  return Object.values(item.platforms).filter((state): state is PlatformState => Boolean(state));
}

/**
 * Which run a queue item belongs to. `runId` is stamped on everything the
 * pipeline books; `jobId` is the older link and only ever covered clips, so it
 * is the fallback that keeps posts booked before this existed countable.
 */
function runIdFor(item: QueueItem, runByJobId: ReadonlyMap<string, string>): string | undefined {
  return item.runId ?? (item.jobId ? runByJobId.get(item.jobId) : undefined);
}

export function deliveryByRun(
  items: readonly QueueItem[],
  runByJobId: ReadonlyMap<string, string>,
  now = new Date()
): Map<string, RunDelivery> {
  const byRun = new Map<string, RunDelivery>();
  for (const item of items) {
    const runId = runIdFor(item, runByJobId);
    if (!runId) continue;
    const current = byRun.get(runId) ?? { ...EMPTY };
    const platforms = states(item);
    const posted = platforms.some((state) => state.status === "published");
    const uploading = !posted && platforms.some((state) => state.status === "uploaded" || state.status === "scheduled");
    const failed = platforms.length > 0 && platforms.every((state) => state.status === "failed");
    current.booked += 1;
    if (posted) current.posted += 1;
    else if (uploading) current.uploading += 1;
    else if (failed) current.failed += 1;
    if (!posted && !failed && item.publishAt > now.toISOString()) {
      if (!current.nextAt || item.publishAt < current.nextAt) current.nextAt = item.publishAt;
    }
    byRun.set(runId, current);
  }
  return byRun;
}

export function emptyDelivery(): RunDelivery {
  return { ...EMPTY };
}
