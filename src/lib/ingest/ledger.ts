import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IngestLedger, IngestRecord } from "@/lib/ingest/types";

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
  return path.join(process.cwd(), "data", "channel-ingest.json");
}

export async function readLedger(): Promise<IngestLedger> {
  try {
    const parsed = JSON.parse(await readFile(ledgerPath(), "utf8")) as Partial<IngestLedger>;
    return {
      lastScanAt: typeof parsed.lastScanAt === "string" ? parsed.lastScanAt : null,
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

