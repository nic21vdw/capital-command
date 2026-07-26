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
        | "not-public";
      /** True when the skip is a judgement call the human may want to overturn. */
      needsReview?: boolean;
    };

export type ScanCandidate = {
  upload: ChannelUpload;
  decision: IngestDecision;
};

/** One entry in the ledger of what the scan has already taken in. */
export type IngestRecord = {
  videoId: string;
  title: string;
  /** The long-form project the video became, when ingest got that far. */
  projectId: string | null;
  ingestedAt: string;
  /** Terminal outcome of the download+analysis, for the next run's report. */
  outcome: "ready" | "error" | "timeout";
  /**
   * How many scans have tried this video. Only `ready` is done; anything else is
   * retried tomorrow until the cap, so one bad download does not silently
   * disappear — nor re-download a broken three-hour stream every morning
   * forever.
   */
  attempts: number;
  error?: string;
};

export type IngestLedger = {
  lastScanAt: string | null;
  records: IngestRecord[];
};
