import { listJobs } from "@/lib/clipping/jobs";
import { NothingWaitingError, queueRunOutputs, type QueueResult } from "@/lib/pipeline/queueOutputs";
import { getRun, listRuns, updateRun } from "@/lib/pipeline/runs";
import { groupPicks, runBacklog, waitingClips, type BacklogClip, type RunBacklog } from "@/lib/pipeline/shortsBacklog";
import { heldFrom } from "@/lib/publisher/approval";
import { readReviewPolicy } from "@/lib/publisher/approvalStore";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import { publishQueue } from "@/lib/publisher/queue";
import { RUNWAY_DAYS, shortStreamName, shortsRunway, type PlatformRunway } from "@/lib/publisher/runway";
import { tiktokRelayOn } from "@/lib/publisher/tiktokInbox";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

// The Weekly Shorts Review: every finished Short from recent streams that is
// not booked yet, in one list, best first. It books ONLY what he ticks, through
// the pipeline's own booking path (`queueRunOutputs`), so the same-day rule,
// the duplicate guard, the Shorts-per-day cap and any review hold all apply.
// Nothing is ticked for him, nothing is approved, and an unticked clip is left
// undecided for next week unless he presses Skip.

export type ReviewClip = BacklogClip & { stream: string };

export type ShortsReviewState = {
  observedAt: string;
  enabled: boolean;
  problem?: string;
  timezone: string;
  shortsPerDay: number;
  platforms: PlatformId[];
  runwayDays: number;
  runway: PlatformRunway[];
  streams: { runId: string; name: string; ready: number; booked: number; decided: number; waiting: number }[];
  clips: ReviewClip[];
};

export type BookOutcome = {
  booked: { runId: string; title: string; publishAt: string; platforms: PlatformId[] }[];
  failed: { runId: string; title: string; error: string }[];
  stale: string[];
};

export class ReviewBusyError extends Error {
  constructor() {
    super("A booking from this page is already running. Wait for it to finish, then reload.");
    this.name = "ReviewBusyError";
  }
}

type Sources = { backlog: RunBacklog[]; queue: QueueItem[] };

export type ReviewDeps = {
  load: () => Promise<Sources>;
  book: (runId: string, ids: string[]) => Promise<QueueResult>;
  holdBack: (runId: string, ids: string[]) => Promise<void>;
};

async function loadSources(now = new Date()): Promise<Sources> {
  const config = publisherConfig();
  // A failed queue read must throw, not read as empty: an empty queue makes
  // every booked clip look unbooked, and the page would offer it again.
  const [runs, jobs, queue] = await Promise.all([listRuns(), listJobs(), config.enabled ? publishQueue(config).list() : Promise.resolve([])]);
  return { backlog: runBacklog(runs, jobs, queue, now), queue };
}

export const defaultDeps: ReviewDeps = {
  load: () => loadSources(),
  book: (runId, ids) => queueRunOutputs(runId, ids, { seen: [] }),
  holdBack: async (runId, ids) => {
    const run = await getRun(runId);
    if (!run) return;
    const held = new Set(run.queueHeldBack ?? []);
    for (const id of ids) held.add(id);
    await updateRun(run, { queueHeldBack: [...held] });
  }
};

export async function shortsReviewState(now = new Date(), deps: Pick<ReviewDeps, "load"> = defaultDeps): Promise<ShortsReviewState> {
  const config = publisherConfig();
  const { backlog, queue } = await deps.load();
  return {
    observedAt: now.toISOString(),
    enabled: config.enabled,
    problem: config.enabled ? (config.platforms.length ? undefined : "No platforms are switched on. Choose them in Settings before booking anything.") : PUBLISHING_OFF_MESSAGE,
    timezone: config.timezone,
    shortsPerDay: config.shortsPerDay,
    platforms: config.platforms,
    runwayDays: RUNWAY_DAYS,
    runway: shortsRunway(queue, config.platforms, config.shortsPerDay, now, { relayOn: tiktokRelayOn(), held: heldFrom(readReviewPolicy()) }),
    streams: backlog.map((run) => ({ runId: run.runId, name: shortStreamName(run.runName), ready: run.ready, booked: run.booked, decided: run.decided, waiting: run.waiting.length })),
    clips: waitingClips(backlog).map((clip) => ({ ...clip, stream: shortStreamName(clip.runName) }))
  };
}

const LOCK = Symbol.for("capital-command.shorts-review.lock");
type LockHolder = { [LOCK]?: boolean };

/** One booking at a time per process; a second click while one runs is refused, not queued behind it. */
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const holder = globalThis as LockHolder;
  if (holder[LOCK]) throw new ReviewBusyError();
  holder[LOCK] = true;
  try {
    return await work();
  } finally {
    holder[LOCK] = false;
  }
}

export async function bookShortsPicks(picks: string[], deps: ReviewDeps = defaultDeps): Promise<BookOutcome> {
  return exclusive(async () => {
    const { backlog } = await deps.load();
    const { byRun, stale } = groupPicks(picks, waitingClips(backlog));
    const outcome: BookOutcome = { booked: [], failed: [], stale };
    for (const [runId, ids] of byRun) {
      try {
        const result = await deps.book(runId, ids);
        outcome.booked.push(...result.queued.map((entry) => ({ runId, ...entry })));
        outcome.failed.push(...result.failed.map((entry) => ({ runId, ...entry })));
      } catch (error) {
        if (error instanceof NothingWaitingError) {
          outcome.stale.push(...ids);
          continue;
        }
        outcome.failed.push({ runId, title: shortStreamName(backlog.find((run) => run.runId === runId)?.runName ?? runId), error: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcome;
  });
}

/** Skip: he does not want these posted. Undone by ticking them on the stream's own booking sheet. */
export async function skipShorts(ids: string[], deps: ReviewDeps = defaultDeps): Promise<{ skipped: number; stale: string[] }> {
  return exclusive(async () => {
    const { backlog } = await deps.load();
    const { byRun, stale } = groupPicks(ids, waitingClips(backlog));
    let skipped = 0;
    for (const [runId, runIds] of byRun) {
      await deps.holdBack(runId, runIds);
      skipped += runIds.length;
    }
    return { skipped, stale };
  });
}
