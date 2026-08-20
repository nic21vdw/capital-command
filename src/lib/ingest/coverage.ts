import { MAX_INGEST_ATTEMPTS } from "@/lib/ingest/ledger";
import type { ChannelSnapshot, ChannelVideo, IngestLedger, ScanCandidate } from "@/lib/ingest/types";

/**
 * How far behind the channel the pipeline is.
 *
 * The ledger already knows what the scan took in, but "taken in" is not the
 * question — a stream that timed out, and a car recording the live-only scan
 * never looks at, are both work still to do, and neither leaves a trace anyone
 * reads. This joins the last scan's picture of the channel to what the pipeline
 * holds now, so the home screen can say it in one line per kind of video.
 *
 * It costs nothing: the picture is the snapshot the scan already wrote, and the
 * runs are the ones the poll already loaded. Nothing here calls YouTube.
 */

export type CoverageState = "done" | "working" | "attention" | "waiting";

export type CoverageVideo = ChannelVideo & {
  state: CoverageState;
  /** The run holding it, when there is one to open. */
  runId?: string;
  /** What is wrong with it, in the words the run list already uses. */
  note?: string;
};

export type CoverageGroup = {
  kind: ChannelVideo["kind"];
  total: number;
  /** Through the pipeline and finished. */
  done: number;
  /** In the pipeline right now. */
  working: number;
  /** Started and broke, or the scan gave up on it. */
  attention: number;
  /** Never taken in. */
  waiting: number;
  /** The ones not done yet, oldest first — what is actually outstanding. */
  outstanding: CoverageVideo[];
};

export type ChannelCoverage = {
  at: string;
  lookbackDays: number;
  groups: CoverageGroup[];
};

/** What the pipeline currently knows about one video, by its YouTube id. */
export type RunState = Map<string, { state: Exclude<CoverageState, "waiting">; runId: string; label: string }>;

/**
 * The videos the coverage panel counts: everything the scan saw that Nic made
 * and that has work in it. The app's own posts coming back around, Shorts, and
 * anything unlisted are not backlog, so they never appear.
 */
const NOT_MINE = new Set([
  "published-by-distribution-centre",
  "short-vertical",
  "probable-short-unknown-aspect",
  "not-public"
]);

export function snapshotFromCandidates(
  candidates: readonly ScanCandidate[],
  at: string,
  lookbackDays: number
): ChannelSnapshot {
  const videos: ChannelVideo[] = candidates
    .filter((candidate) => !NOT_MINE.has(candidate.decision.reason))
    .map((candidate) => ({
      videoId: candidate.upload.videoId,
      title: candidate.upload.title,
      publishedAt: candidate.upload.publishedAt,
      kind: candidate.upload.wasLiveStream ? "stream" : "upload",
      url: candidate.upload.url
    }));
  videos.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  return { at, lookbackDays, videos };
}

type VideoState = { state: CoverageState; runId?: string; note?: string };

function stateOf(video: ChannelVideo, ledger: IngestLedger, runs: RunState): VideoState {
  const live = runs.get(video.videoId);
  if (live) return { state: live.state, runId: live.runId, note: live.label };
  const record = ledger.records.find((entry) => entry.videoId === video.videoId);
  if (!record) return { state: "waiting" };
  if (record.outcome === "ready") return { state: "done" };
  // The scan stopped retrying this one, so waiting for tomorrow is not going to
  // fix it — it needs a person.
  // No run id here even when the record has one: a video whose run still exists
  // came through `runs` above, so a record that reaches this line is one whose
  // run has since been deleted. Starting it again is the only offer that works.
  if (record.attempts >= MAX_INGEST_ATTEMPTS) {
    return {
      state: "attention",
      note: record.outcome === "timeout" ? "Took too long, the scan gave up" : "The run broke"
    };
  }
  return { state: "waiting" };
}

export function channelCoverage(ledger: IngestLedger, runs: RunState): ChannelCoverage | null {
  const snapshot = ledger.channel;
  if (!snapshot) return null;
  const groups = new Map<ChannelVideo["kind"], CoverageGroup>();
  for (const kind of ["stream", "upload"] as const) {
    groups.set(kind, { kind, total: 0, done: 0, working: 0, attention: 0, waiting: 0, outstanding: [] });
  }
  for (const video of snapshot.videos) {
    const group = groups.get(video.kind)!;
    const { state, runId, note } = stateOf(video, ledger, runs);
    group.total += 1;
    group[state] += 1;
    if (state !== "done") group.outstanding.push({ ...video, state, runId, note });
  }
  return {
    at: snapshot.at,
    lookbackDays: snapshot.lookbackDays,
    groups: [...groups.values()].filter((group) => group.total > 0)
  };
}
