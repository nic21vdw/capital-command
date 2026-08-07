import { decideUpload, explainDecision } from "@/lib/ingest/classify";
import { scanChannelUploads } from "@/lib/ingest/channelScan";
import {
  attemptsFor,
  readLedger,
  recordScanOutcome,
  settledVideoIds,
  upsertRecord,
  writeLedger,
  MAX_INGEST_ATTEMPTS
} from "@/lib/ingest/ledger";
import {
  AppUnreachableError,
  appBaseUrl,
  pipelineSourceVideoIds,
  startPipelineRun,
  waitForPipelineRun
} from "@/lib/ingest/pipelineClient";
import type { IngestLedger, IngestRecord, ScanCandidate } from "@/lib/ingest/types";
import { publishQueue } from "@/lib/publisher/queue";

/**
 * The daily scan, end to end: read the channel, decide, hand what is new to the
 * Stream Pipeline and wait for it to fan out.
 *
 * The scan takes a stream all the way through the pipeline — long-form edit,
 * clips, podcast MP3, carousel, text posts — and stops at "ready to schedule"
 * unless `settings.autoScheduleOvernight` is on, in which case the run also
 * books its outputs into the publish and Threads queues at future slots. The
 * scan asks for that on every run; `POST /api/pipeline` decides from the
 * setting, so the answer is never taken from a request.
 */

/**
 * How long to wait for one stream's full fan-out. A long VOD is a big download
 * before any of the work starts; past this the scan stops waiting, records a
 * timeout, and lets the next run re-check. The work itself is not cancelled —
 * the app keeps going, and tomorrow's scan sees the finished run.
 */
const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const POLL_MS = 10_000;

export type ScanReport = {
  configured: boolean;
  needsReconnect: boolean;
  channelId: string | null;
  candidates: ScanCandidate[];
  ingested: IngestRecord[];
  /** Skips the human may want to overturn (see decideUpload). */
  needsReview: ScanCandidate[];
  dryRun: boolean;
};

/**
 * Every YouTube videoId this app has published, from the publish queue. This is
 * the authoritative "the distribution centre made this" signal — see classify.ts.
 *
 * A read failure is fatal on purpose. Returning an empty set on error would look
 * like "nothing has ever been published" and leave the Shorts shape heuristic as
 * the only guard — which is exactly how the pipeline would start re-clipping its
 * own output. Better to skip a day's scan than to eat the tail.
 *
 * @param queueEmpty set to true when the queue read succeeded but held no
 *   YouTube posts, so the caller can say so rather than assume provenance is
 *   protecting anything.
 */
export async function publishedPostIds(): Promise<{ ids: Set<string>; queueEmpty: boolean }> {
  let items;
  try {
    items = await publishQueue().list();
  } catch (error) {
    throw new Error(
      `Could not read the publish queue, so there is no way to tell this app's own uploads from new content. ` +
        `Refusing to ingest. Cause: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const ids = new Set<string>();
  for (const item of items) {
    const postId = item.platforms.youtube?.postId;
    if (postId) ids.add(postId);
  }
  return { ids, queueEmpty: ids.size === 0 };
}

export type RunOptions = {
  now?: Date;
  accountId?: string;
  lookbackDays?: number;
  /** Decide and report, but take nothing in and write no ledger. */
  dryRun?: boolean;
  /** Cap on how many videos one run will take in. Guards against a backlog
   *  turning one scheduled run into an all-day download. */
  limit?: number;
  timeoutMs?: number;
  pollMs?: number;
  /**
   * Take in live stream VODs only and leave ordinary uploads alone. On by
   * default: the scheduled run exists to catch streams, and a stream is the
   * thing worth fanning out into every format without being asked. Pass false
   * to take in long-form uploads too.
   */
  liveOnly?: boolean;
  log?: (message: string) => void;
};

/**
 * Every scan writes how it ended into the ledger before it returns. The nightly
 * one runs as its own process, so this file is the only place its outcome can
 * survive — without it, a scan that failed at 6am was invisible until someone
 * noticed nothing had been ingested for days.
 */
export async function runDailyScan(options: RunOptions = {}): Promise<ScanReport> {
  const startedAt = new Date().toISOString();
  try {
    const report = await runScan(options);
    await recordScanOutcome({
      at: startedAt,
      status: report.configured ? (report.needsReconnect ? "needs-reconnect" : "ok") : "not-connected",
      ingested: report.ingested.length,
      dryRun: report.dryRun
    });
    return report;
  } catch (error) {
    await recordScanOutcome({
      at: startedAt,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function runScan(options: RunOptions = {}): Promise<ScanReport> {
  const log = options.log ?? (() => {});
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? 3;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const liveOnly = options.liveOnly ?? true;
  const now = options.now ?? new Date();

  const scan = await scanChannelUploads({
    now,
    accountId: options.accountId,
    lookbackDays: options.lookbackDays
  });
  if (!scan.configured) {
    log("YouTube is not connected — nothing to scan. Connect the channel in the Uploading Center.");
    return {
      configured: false,
      needsReconnect: false,
      channelId: null,
      candidates: [],
      ingested: [],
      needsReview: [],
      dryRun
    };
  }
  if (scan.needsReconnect) {
    log("YouTube returned 403: the stored token predates the readonly scope. Reconnect the channel.");
    return {
      configured: true,
      needsReconnect: true,
      channelId: scan.channelId,
      candidates: [],
      ingested: [],
      needsReview: [],
      dryRun
    };
  }

  let ledger = await readLedger();
  const published = await publishedPostIds();
  if (published.queueEmpty) {
    // Legitimate on a fresh setup, but worth saying: until the queue has posts
    // in it, the only thing standing between a Short and the pipeline is the
    // shape heuristic.
    log(
      "Note: the publish queue holds no YouTube posts yet, so Shorts are being identified by shape alone " +
        "(<= 3 min and vertical), not by provenance."
    );
  }
  // Third guard: what the pipeline already holds. A read failure here is NOT
  // fatal the way the publish-queue read is — the ledger and provenance still
  // stand — but it is said out loud, because the run that would be re-ingested
  // is an expensive mistake rather than a wrong one.
  let pipelineVideoIds = new Set<string>();
  try {
    pipelineVideoIds = await pipelineSourceVideoIds();
  } catch (error) {
    log(
      `Warning: could not read existing pipeline runs (${
        error instanceof Error ? error.message : String(error)
      }). A stream already taken in by hand could be ingested again.`
    );
  }

  const seen = {
    publishedPostIds: published.ids,
    ingestedVideoIds: settledVideoIds(ledger),
    pipelineVideoIds
  };

  const candidates: ScanCandidate[] = scan.uploads.map((upload) => ({
    upload,
    decision: decideUpload(upload, seen, { liveOnly })
  }));

  log(
    `Found ${candidates.length} upload(s) in the lookback window` +
      (liveOnly ? " (live streams only)." : ".")
  );
  for (const candidate of candidates) {
    const verb = candidate.decision.action === "ingest" ? "INGEST" : "skip  ";
    log(`  ${verb}  ${candidate.upload.videoId}  ${explainDecision(candidate.decision)}  ${candidate.upload.title}`);
  }

  const toIngest = candidates.filter((candidate) => candidate.decision.action === "ingest");
  const needsReview = candidates.filter(
    (candidate) => candidate.decision.action === "skip" && candidate.decision.needsReview
  );

  const ingested: IngestRecord[] = [];
  if (dryRun) {
    log(`Dry run — would take in ${Math.min(toIngest.length, limit)} of ${toIngest.length}.`);
    return {
      configured: true,
      needsReconnect: false,
      channelId: scan.channelId,
      candidates,
      ingested: [],
      needsReview,
      dryRun
    };
  }

  if (toIngest.length > limit) {
    // Said out loud rather than quietly truncated: a silent cap looks like the
    // scan decided the rest were Shorts.
    log(`Taking the oldest ${limit} of ${toIngest.length}; the rest are picked up by the next run.`);
  }

  log(`Handing streams to the pipeline at ${appBaseUrl()}.`);

  for (const candidate of toIngest.slice(0, limit)) {
    const { upload } = candidate;
    const attempts = attemptsFor(ledger, upload.videoId) + 1;
    log(`Ingesting ${upload.videoId} (attempt ${attempts}/${MAX_INGEST_ATTEMPTS}): ${upload.title}`);

    let record: IngestRecord;
    // Held outside the try so a failure *after* the run started still records
    // which run it was. Losing that link leaves a run nobody can trace back to
    // the video that created it.
    let startedRunId: string | null = null;
    try {
      const runId = await startPipelineRun(upload.url, upload.title);
      startedRunId = runId;
      log(`    pipeline run ${runId} started`);
      const result = await waitForPipelineRun(runId, timeoutMs, pollMs, (line) => log(`    ${line}`));

      const schedulable = result.overview?.schedulable;
      record = {
        videoId: upload.videoId,
        title: upload.title,
        runId,
        projectId: result.overview?.run.longformProjectId ?? null,
        ingestedAt: new Date().toISOString(),
        outcome: result.outcome,
        attempts,
        ...(schedulable
          ? {
              outputs: {
                clipsReady: schedulable.clipsReady,
                longformReady: schedulable.longformReady,
                segments: schedulable.segments,
                segmentsRendered: schedulable.segmentsRendered,
                audioReady: schedulable.audioReady,
                podcastPublished: schedulable.podcastPublished,
                carouselSlides: schedulable.carouselSlides,
                posts: schedulable.posts
              }
            }
          : {}),
        ...(result.error ? { error: result.error } : {})
      };

      if (result.outcome === "ready") log(`    ready — ${summarizeOutputs(record)}`);
      else if (result.outcome === "timeout") log(`    still running after the timeout; will re-check next run`);
      else log(`    failed: ${result.error}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record = {
        videoId: upload.videoId,
        title: upload.title,
        runId: startedRunId,
        projectId: null,
        ingestedAt: new Date().toISOString(),
        outcome: "error",
        attempts,
        error: message
      };
      log(startedRunId ? `    run ${startedRunId} failed: ${message}` : `    failed to start: ${message}`);
      if (error instanceof AppUnreachableError) {
        // Nothing will succeed until the app is back up. Recording this video
        // and stopping beats burning an attempt on every remaining stream for
        // the same reason — three unreachable days would otherwise abandon the
        // whole backlog.
        ingested.push(record);
        ledger = upsertRecord(ledger, record);
        await writeLedger({ ...ledger, lastScanAt: new Date().toISOString() });
        log("Stopping the scan: the app is not reachable, so nothing else can be handed over either.");
        break;
      }
    }

    ingested.push(record);
    // Written per video, not once at the end: a crash halfway through a backlog
    // must not lose the record of what already came in.
    ledger = upsertRecord(ledger, record);
    await writeLedger({ ...ledger, lastScanAt: new Date().toISOString() });
  }

  if (ingested.length === 0) {
    ledger = { ...ledger, lastScanAt: new Date().toISOString() };
    await writeLedger(ledger);
  }

  return {
    configured: true,
    needsReconnect: false,
    channelId: scan.channelId,
    candidates,
    ingested,
    needsReview,
    dryRun
  };
}

/** What a settled run produced, in one line for the log and the report. */
export function summarizeOutputs(record: IngestRecord): string {
  const outputs = record.outputs;
  if (!outputs) return `run ${record.runId ?? "?"}`;
  // Segments are counted rendered/planned on purpose: an overnight report that
  // said "ready to schedule" while five ten-minute videos still needed a click
  // was the report being wrong about the only thing it exists to say.
  const segments = outputs.segments ?? 0;
  const parts = [
    outputs.longformReady ? "long-form edit" : null,
    outputs.clipsReady > 0 ? `${outputs.clipsReady} clip${outputs.clipsReady === 1 ? "" : "s"}` : null,
    segments > 0
      ? `${outputs.segmentsRendered ?? 0} of ${segments} topic segment${segments === 1 ? "" : "s"} rendered`
      : null,
    outputs.audioReady ? "podcast MP3" : null,
    outputs.podcastPublished ? "podcast episode published" : null,
    outputs.carouselSlides > 0 ? `${outputs.carouselSlides}-slide carousel` : null,
    outputs.posts > 0 ? `${outputs.posts} text post${outputs.posts === 1 ? "" : "s"}` : null
  ].filter(Boolean);
  if (parts.length === 0) return `run ${record.runId ?? "?"} settled with no outputs`;
  return `run ${record.runId ?? "?"}: ${parts.join(", ")} ready to schedule`;
}

/** Ledger shape for callers that only want to read it (e.g. a dashboard panel). */
export async function ingestLedger(): Promise<IngestLedger> {
  return readLedger();
}
