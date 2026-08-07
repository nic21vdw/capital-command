import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IngestLedger, IngestRecord, LedgerScan } from "@/lib/ingest/types";
import { dataPath } from "@/lib/paths";

/**
 * What the scan has already taken in.
 *
 * Without this, a daily scan re-downloads the same three-hour stream every
 * morning: the publish queue only knows what this app *published*, and an
 * ingested stream is not published until you have clipped it, which may be days
 * later or never.
 *
 * Single JSON document with the repo's atomic write-then-rename (see README
 * "Why this persistence choice", and publisher/store.ts for the same pattern
 * including the Windows rename fallback).
 */

const EMPTY: IngestLedger = { lastScanAt: null, records: [] };

export function ledgerPath(): string {
  return dataPath("channel-ingest.json");
}

export async function readLedger(): Promise<IngestLedger> {
  try {
    const parsed = JSON.parse(await readFile(ledgerPath(), "utf8")) as Partial<IngestLedger>;
    return {
      lastScanAt: typeof parsed.lastScanAt === "string" ? parsed.lastScanAt : null,
      ...(parsed.lastScan && typeof parsed.lastScan === "object" ? { lastScan: parsed.lastScan } : {}),
      records: Array.isArray(parsed.records) ? parsed.records : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    // A corrupt ledger must not wedge the scan forever, but silently starting
    // over would re-ingest everything — so this one is loud.
    throw new Error(
      `Could not read the ingest ledger at ${ledgerPath()}: ${
        error instanceof Error ? error.message : String(error)
      }. Fix or delete the file (deleting it will re-ingest recent uploads).`
    );
  }
}

export async function writeLedger(ledger: IngestLedger): Promise<void> {
  const filePath = ledgerPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const text = JSON.stringify(ledger, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, text, "utf8");
  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
      await writeFile(filePath, text, "utf8");
      await unlink(tmpPath).catch(() => undefined);
      return;
    }
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

/**
 * How many times a failing video is retried on later scans before the scan
 * gives up on it and leaves it to be done by hand.
 */
export const MAX_INGEST_ATTEMPTS = 3;

/**
 * Ids the scan should not look at again: the ones that finished, plus the ones
 * that have failed enough times to stop being worth a daily retry.
 *
 * Anything else stays absent from this set on purpose, so a stream whose
 * download died halfway is picked up again tomorrow rather than being recorded
 * as handled.
 */
export function settledVideoIds(ledger: IngestLedger): Set<string> {
  const settled = new Set<string>();
  for (const record of ledger.records) {
    if (record.outcome === "ready" || record.attempts >= MAX_INGEST_ATTEMPTS) settled.add(record.videoId);
  }
  return settled;
}

/** Attempts already spent on a video, for bumping the count on a retry. */
export function attemptsFor(ledger: IngestLedger, videoId: string): number {
  return ledger.records.find((record) => record.videoId === videoId)?.attempts ?? 0;
}

/** Videos the scan has given up on — surfaced in the report, not silently dropped. */
export function abandonedRecords(ledger: IngestLedger): IngestRecord[] {
  return ledger.records.filter(
    (record) => record.outcome !== "ready" && record.attempts >= MAX_INGEST_ATTEMPTS
  );
}

/**
 * Puts a video the scan gave up on back in the queue by spending its attempts
 * back down to zero — `settledVideoIds` stops counting it, so the next scan
 * takes it in again. Anything already `ready` is left exactly as it is: it is
 * settled by its outcome, not by its attempt count, and re-ingesting a stream
 * the pipeline already finished is never what this button means.
 */
export function clearAttempts(ledger: IngestLedger, videoId: string): IngestLedger {
  return {
    ...ledger,
    records: ledger.records.map((record) =>
      record.videoId === videoId && record.outcome !== "ready" ? { ...record, attempts: 0 } : record
    )
  };
}

/**
 * Adds (or replaces) a record. Replacing matters on a re-run after a failure:
 * the video keeps one row that reflects its latest outcome rather than
 * accumulating one row per attempt.
 */
export function upsertRecord(ledger: IngestLedger, record: IngestRecord): IngestLedger {
  const records = ledger.records.filter((existing) => existing.videoId !== record.videoId);
  records.push(record);
  records.sort((a, b) => a.ingestedAt.localeCompare(b.ingestedAt));
  return { ...ledger, records };
}


/**
 * Records how a scan ended, from whichever process ran it. Best effort on
 * purpose: failing to write the note must not turn a scan that worked into a
 * scan that failed.
 */
export async function recordScanOutcome(scan: LedgerScan): Promise<void> {
  try {
    const ledger = await readLedger();
    // A DRY RUN proves nothing about the real path — it never hands a stream
    // over — so it must not clear a real failure. And `lastScanAt` only ever
    // moves forward: `scan.at` is when the scan STARTED, and the per-video
    // writes during it are later than that.
    if (scan.dryRun && ledger.lastScan && ledger.lastScan.status !== "ok" && !ledger.lastScan.dryRun) {
      return;
    }
    const lastScanAt =
      ledger.lastScanAt && ledger.lastScanAt > scan.at ? ledger.lastScanAt : scan.at;
    await writeLedger({ ...ledger, lastScan: scan, lastScanAt });
  } catch {
    // The ledger's own read error is already loud where it matters.
  }
}

/** A scan older than this has not run — a disabled task, or a machine asleep. */
export const SCAN_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * How the last scan ended, or `stale` when there has not been one lately. A
 * scheduled task that was switched off looks exactly like a healthy "ok"
 * otherwise: the last success sits there forever while nothing comes in.
 */
export function scanHealth(
  ledger: Pick<IngestLedger, "lastScan" | "lastScanAt">,
  now = new Date()
): (LedgerScan & { staleSince?: string }) | null {
  const last = ledger.lastScan ?? null;
  const at = ledger.lastScanAt ?? last?.at ?? null;
  if (!at) return null;
  const age = now.getTime() - new Date(at).getTime();
  if (Number.isFinite(age) && age > SCAN_STALE_AFTER_MS) {
    return { at, status: "stale", staleSince: at, ...(last?.error ? { error: last.error } : {}) };
  }
  return last;
}
