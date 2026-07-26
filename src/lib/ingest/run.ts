import { decideUpload, explainDecision } from "@/lib/ingest/classify";
import { scanChannelUploads } from "@/lib/ingest/channelScan";
import {
  attemptsFor,
  readLedger,
  settledVideoIds,
  upsertRecord,
  writeLedger,
  MAX_INGEST_ATTEMPTS
} from "@/lib/ingest/ledger";
import type { IngestLedger, IngestRecord, ScanCandidate } from "@/lib/ingest/types";
import { createProjectFromUrl, getProject } from "@/lib/longform/store";
import { publishQueue } from "@/lib/publisher/queue";

/**
 * The daily scan, end to end: read the channel, decide, take in what is new.
 *
 * Ingest stops at an analyzed long-form project. Nothing here clips or
 * publishes — new content lands in the app for you to look at, and never goes
 * out to a channel unreviewed.
 */

/**
 * How long to wait for one video's download + analysis. A long stream VOD is a
 * big download; past this the scan stops waiting, records a timeout, and lets
 * the next run retry. The work itself is not cancelled — it keeps going in the
 * app if the app is what is running it.
 */
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const POLL_MS = 5000;

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

/**
 * Waits for a project to reach a terminal state.
 *
 * `createProjectFromUrl` returns immediately and does the download in the
 * background (`void downloadAndAnalyze`), which is right for the web app but
 * would let a one-shot CLI exit mid-download. Polling the store keeps the
 * process alive and turns the fire-and-forget into something a scheduled task
 * can actually report on.
 */
async function waitForProject(
  projectId: string,
  timeoutMs: number,
  onProgress?: (stage: string, progress: number) => void
): Promise<{ outcome: "ready" | "error" | "timeout"; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastStage = "";
  while (Date.now() < deadline) {
    const project = await getProject(projectId);
    if (!project) return { outcome: "error", error: "The project disappeared from the store." };
    if (project.stage !== lastStage) {
      lastStage = project.stage;
      onProgress?.(project.stage, project.progress);
    }
    if (project.status === "ready") return { outcome: "ready" };
    if (project.status === "error") return { outcome: "error", error: project.error ?? "Analysis failed." };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { outcome: "timeout" };
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
  log?: (message: string) => void;
};

export async function runDailyScan(options: RunOptions = {}): Promise<ScanReport> {
  const log = options.log ?? (() => {});
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? 3;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
  const seen = {
    publishedPostIds: published.ids,
    ingestedVideoIds: settledVideoIds(ledger)
  };

  const candidates: ScanCandidate[] = scan.uploads.map((upload) => ({
    upload,
    decision: decideUpload(upload, seen)
  }));

  log(`Found ${candidates.length} upload(s) in the lookback window.`);
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

  for (const candidate of toIngest.slice(0, limit)) {
    const { upload } = candidate;
    const attempts = attemptsFor(ledger, upload.videoId) + 1;
    log(`Ingesting ${upload.videoId} (attempt ${attempts}/${MAX_INGEST_ATTEMPTS}): ${upload.title}`);

    let record: IngestRecord;
    try {
      const project = await createProjectFromUrl(upload.url, upload.title);
      const result = await waitForProject(project.id, timeoutMs, (stage, progress) =>
        log(`    ${stage} ${progress}%`)
      );
      record = {
        videoId: upload.videoId,
        title: upload.title,
        projectId: project.id,
        ingestedAt: new Date().toISOString(),
        outcome: result.outcome,
        attempts,
        ...(result.error ? { error: result.error } : {})
      };
      if (result.outcome === "ready") log(`    ready — project ${project.id}`);
      else if (result.outcome === "timeout") log(`    still running after the timeout; will re-check next run`);
      else log(`    failed: ${result.error}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record = {
        videoId: upload.videoId,
        title: upload.title,
        projectId: null,
        ingestedAt: new Date().toISOString(),
        outcome: "error",
        attempts,
        error: message
      };
      log(`    failed to start: ${message}`);
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

/** Ledger shape for callers that only want to read it (e.g. a dashboard panel). */
export async function ingestLedger(): Promise<IngestLedger> {
  return readLedger();
}
