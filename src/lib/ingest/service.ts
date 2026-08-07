import { setAppBaseUrl } from "@/lib/ingest/pipelineClient";
import { ingestLedger, runDailyScan, summarizeOutputs } from "@/lib/ingest/run";
import type { ScanReport } from "@/lib/ingest/run";
import { explainDecision } from "@/lib/ingest/classify";
import { abandonedRecords, clearAttempts, MAX_INGEST_ATTEMPTS, readLedger, writeLedger } from "@/lib/ingest/ledger";

export type IngestJob = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  liveOnly: boolean;
  limit: number;
  status: "running" | "completed" | "failed";
  log: string[];
  report: ScanReport | null;
  error: string | null;
};

type JobStore = { jobs: Map<string, IngestJob>; activeId: string | null };

const MAX_LOG_LINES = 400;
const MAX_JOBS = 10;

function store(): JobStore {
  const holder = globalThis as typeof globalThis & { __capitalCommandIngestJobs?: JobStore };
  if (!holder.__capitalCommandIngestJobs) holder.__capitalCommandIngestJobs = { jobs: new Map(), activeId: null };
  return holder.__capitalCommandIngestJobs;
}

export function activeIngestJob(): IngestJob | null {
  const state = store();
  const job = state.activeId ? state.jobs.get(state.activeId) ?? null : null;
  return job && job.status === "running" ? job : null;
}

export function listIngestJobs(): IngestJob[] {
  return [...store().jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getIngestJob(id: string): IngestJob | null {
  return store().jobs.get(id) ?? null;
}

export type StartScanOptions = {
  dryRun?: boolean;
  liveOnly?: boolean;
  limit?: number;
  lookbackDays?: number;
  baseUrl?: string;
};

export function startIngestScan(options: StartScanOptions = {}): IngestJob {
  const state = store();
  const running = activeIngestJob();
  if (running) return running;
  if (options.baseUrl) setAppBaseUrl(options.baseUrl);

  const job: IngestJob = {
    id: `ingest-${crypto.randomUUID()}`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    dryRun: options.dryRun ?? false,
    liveOnly: options.liveOnly ?? true,
    limit: options.limit ?? 3,
    status: "running",
    log: [],
    report: null,
    error: null
  };
  state.jobs.set(job.id, job);
  state.activeId = job.id;
  for (const old of listIngestJobs().slice(MAX_JOBS)) state.jobs.delete(old.id);

  const log = (message: string) => {
    job.log.push(message);
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
  };

  void runDailyScan({
    dryRun: job.dryRun,
    liveOnly: job.liveOnly,
    limit: job.limit,
    lookbackDays: options.lookbackDays,
    log
  })
    .then((report) => {
      job.report = report;
      job.status = "completed";
    })
    .catch((error: unknown) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      log(`Scan failed: ${job.error}`);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      if (state.activeId === job.id) state.activeId = null;
    });

  return job;
}

/**
 * Hands a given-up video back to the scan. Returns false when the ledger has
 * nothing to reset, so the screen can say "nothing changed" instead of
 * promising a retry that will never come.
 */
export async function retryAbandonedIngest(videoId: string): Promise<boolean> {
  const ledger = await readLedger();
  const next = clearAttempts(ledger, videoId);
  const changed = next.records.some((record, index) => record.attempts !== ledger.records[index]?.attempts);
  if (!changed) return false;
  await writeLedger(next);
  return true;
}

export function summarizeJob(job: IngestJob) {
  const report = job.report;
  return {
    id: job.id,
    status: job.status,
    dryRun: job.dryRun,
    liveOnly: job.liveOnly,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    log: job.log.slice(-40),
    ...(report
      ? {
          configured: report.configured,
          needsReconnect: report.needsReconnect,
          candidates: report.candidates.map((candidate) => ({
            videoId: candidate.upload.videoId,
            title: candidate.upload.title,
            publishedAt: candidate.upload.publishedAt,
            wasLiveStream: candidate.upload.wasLiveStream,
            action: candidate.decision.action,
            reason: explainDecision(candidate.decision)
          })),
          ingested: report.ingested.map((record) => ({
            videoId: record.videoId,
            title: record.title,
            runId: record.runId,
            outcome: record.outcome,
            summary: summarizeOutputs(record)
          })),
          needsReview: report.needsReview.map((candidate) => ({
            videoId: candidate.upload.videoId,
            title: candidate.upload.title,
            reason: explainDecision(candidate.decision)
          }))
        }
      : {})
  };
}

/**
 * The most recent scan that is over. A failed scan leaves nothing in
 * `running`, which is how a scan that blew up read on screen as "nothing taken
 * in yet" — the outcome has to outlive the job.
 */
function lastFinishedJob(): IngestJob | null {
  return listIngestJobs().find((job) => job.status !== "running") ?? null;
}

export async function ingestOverview() {
  const ledger = await ingestLedger();
  const running = activeIngestJob();
  const finished = lastFinishedJob();
  return {
    lastScanAt: ledger.lastScanAt,
    lastScan: finished ? summarizeJob(finished) : null,
    // From the ledger, so a scan the SCHEDULED TASK ran (its own process, its
    // own memory) is still reportable here.
    lastScanOutcome: ledger.lastScan ?? null,
    abandoned: abandonedRecords(ledger).map((record) => ({
      videoId: record.videoId,
      title: record.title,
      attempts: record.attempts,
      outcome: record.outcome,
      summary: summarizeOutputs(record)
    })),
    maxAttempts: MAX_INGEST_ATTEMPTS,
    taken: ledger.records.slice(0, 15).map((record) => ({
      videoId: record.videoId,
      title: record.title,
      runId: record.runId,
      outcome: record.outcome,
      attempts: record.attempts,
      ingestedAt: record.ingestedAt,
      summary: summarizeOutputs(record)
    })),
    running: running ? summarizeJob(running) : null,
    jobs: listIngestJobs().map((job) => ({
      id: job.id,
      status: job.status,
      dryRun: job.dryRun,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt
    }))
  };
}
