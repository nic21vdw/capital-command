/**
 * Types for the daily channel scan.
 *
 * The scan answers one question per video on the channel: is this something I
 * made that the distribution centre has not seen, or is it the distribution
 * centre's own output coming back around?
 */

/** One video on the channel, reduced to just what the decision needs. */
export type ChannelUpload = {
  videoId: string;
  title: string;
  /** UTC ISO-8601. */
  publishedAt: string;
  /** Seconds, from contentDetails.duration. 0 when YouTube gave us nothing. */
  durationSec: number;
  /**
   * Frame shape, when we could work it out. `null` means unknown — the API has
   * no aspect-ratio field, so this is derived (see channelScan.ts) and is
   * allowed to fail.
   */
  aspect: { width: number; height: number } | null;
  /** True when the video has liveStreamingDetails — i.e. it was a live stream. */
  wasLiveStream: boolean;
  privacyStatus: string;
  url: string;
};

/**
 * Why a video was or was not taken into the pipeline. Every candidate gets one,
 * including the skips: a scan that silently drops things is impossible to trust.
 */
export type IngestDecision =
  | { action: "ingest"; reason: "live-stream" | "long-form-upload" }
  | {
      action: "skip";
      reason:
        | "published-by-distribution-centre"
        | "already-ingested"
        | "short-vertical"
        | "probable-short-unknown-aspect"
        | "not-public"
        | "not-a-live-stream"
        | "already-in-the-pipeline";
      /** True when the skip is a judgement call the human may want to overturn. */
      needsReview?: boolean;
    };

export type ScanCandidate = {
  upload: ChannelUpload;
  decision: IngestDecision;
};

/** What one settled pipeline run produced, recorded so the report can say it. */
export type IngestOutputs = {
  clipsReady: number;
  longformReady: boolean;
  /** Subjects the stream split into. Each is a separate video, rendered on demand. */
  segments: number;
  segmentsRendered: number;
  audioReady: boolean;
  podcastPublished: boolean;
  carouselSlides: number;
  posts: number;
};

/** One entry in the ledger of what the scan has already taken in. */
export type IngestRecord = {
  videoId: string;
  title: string;
  /** The pipeline run the video was handed to, when the scan got that far. */
  runId: string | null;
  /** The long-form project inside that run, once the run created one. */
  projectId: string | null;
  ingestedAt: string;
  /** Terminal outcome of the whole pipeline run, for the next run's report. */
  outcome: "ready" | "error" | "timeout";
  /** What the run produced, once it settled. */
  outputs?: IngestOutputs;
  /**
   * How many scans have tried this video. Only `ready` is done; anything else is
   * retried tomorrow until the cap, so one bad download does not silently
   * disappear — nor re-download a broken three-hour stream every morning
   * forever.
   */
  attempts: number;
  error?: string;
};

/**
 * How the last scan ended, on disk rather than in memory. The nightly scan is a
 * SEPARATE PROCESS from the app server, so an in-memory job record cannot
 * survive it — which is how an overnight failure stayed invisible: the app had
 * nothing to read.
 */
export type LedgerScan = {
  at: string;
  status: "ok" | "failed" | "not-connected" | "needs-reconnect";
  /** What went wrong, when something did. */
  error?: string;
  ingested?: number;
  dryRun?: boolean;
};

export type IngestLedger = {
  lastScanAt: string | null;
  /** The outcome of the most recent scan, whichever process ran it. */
  lastScan?: LedgerScan;
  records: IngestRecord[];
};
