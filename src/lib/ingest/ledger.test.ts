import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abandonedRecords,
  attemptsFor,
  MAX_INGEST_ATTEMPTS,
  readLedger,
  settledVideoIds,
  upsertRecord,
  writeLedger
} from "@/lib/ingest/ledger";
import type { IngestLedger, IngestRecord } from "@/lib/ingest/types";

/**
 * The ledger is what stops a daily scan re-downloading the same three-hour
 * stream every morning — and what stops a single bad download being recorded as
 * handled. Both directions are tested here.
 */

let dir: string;
let cwd: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ingest-ledger-"));
  cwd = process.cwd();
  // The ledger path is derived from cwd, matching the other JSON stores.
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
  expect(process.cwd()).toBe(cwd);
});

function record(overrides: Partial<IngestRecord> = {}): IngestRecord {
  return {
    videoId: "vid-1",
    title: "Sunday stream",
    projectId: "proj-1",
    ingestedAt: "2026-07-26T12:00:00.000Z",
    outcome: "ready",
    attempts: 1,
    ...overrides
  };
}

describe("readLedger", () => {
  it("returns an empty ledger when the file does not exist", async () => {
    expect(await readLedger()).toEqual({ lastScanAt: null, records: [] });
  });

  it("round-trips through disk", async () => {
    const ledger: IngestLedger = { lastScanAt: "2026-07-26T12:00:00.000Z", records: [record()] };
    await writeLedger(ledger);
    expect(await readLedger()).toEqual(ledger);
    // Written as readable JSON, like the other stores in data/.
    const raw = await readFile(path.join(dir, "data", "channel-ingest.json"), "utf8");
    expect(raw).toContain("\n  ");
  });

  // Silently starting over would re-ingest everything already taken in, so a
  // corrupt ledger has to be loud rather than convenient.
  it("throws on a corrupt ledger instead of quietly resetting", async () => {
    await writeLedger({ lastScanAt: null, records: [] });
    await writeFile(path.join(dir, "data", "channel-ingest.json"), "{ not json", "utf8");
    await expect(readLedger()).rejects.toThrow(/Could not read the ingest ledger/);
  });

  it("tolerates a ledger missing its fields", async () => {
    await writeLedger({ lastScanAt: null, records: [] });
    await writeFile(path.join(dir, "data", "channel-ingest.json"), "{}", "utf8");
    expect(await readLedger()).toEqual({ lastScanAt: null, records: [] });
  });
});

describe("upsertRecord", () => {
  it("replaces a video's row rather than accumulating one per attempt", async () => {
    let ledger: IngestLedger = { lastScanAt: null, records: [] };
    ledger = upsertRecord(ledger, record({ outcome: "error", attempts: 1, error: "download failed" }));
    ledger = upsertRecord(ledger, record({ outcome: "ready", attempts: 2 }));

    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]).toMatchObject({ outcome: "ready", attempts: 2 });
  });

  it("keeps records in ingest order", () => {
    let ledger: IngestLedger = { lastScanAt: null, records: [] };
    ledger = upsertRecord(ledger, record({ videoId: "b", ingestedAt: "2026-07-26T12:00:00.000Z" }));
    ledger = upsertRecord(ledger, record({ videoId: "a", ingestedAt: "2026-07-25T12:00:00.000Z" }));
    expect(ledger.records.map((entry) => entry.videoId)).toEqual(["a", "b"]);
  });
});

describe("settledVideoIds", () => {
  it("counts a finished ingest as settled", () => {
    const ledger: IngestLedger = { lastScanAt: null, records: [record({ outcome: "ready" })] };
    expect(settledVideoIds(ledger).has("vid-1")).toBe(true);
  });

  // The important one: a failure must be retried tomorrow, not recorded as done.
  it("leaves a failure unsettled so the next scan retries it", () => {
    const ledger: IngestLedger = {
      lastScanAt: null,
      records: [record({ outcome: "error", attempts: 1 })]
    };
    expect(settledVideoIds(ledger).has("vid-1")).toBe(false);
  });

  it("leaves a timeout unsettled", () => {
    const ledger: IngestLedger = {
      lastScanAt: null,
      records: [record({ outcome: "timeout", attempts: 1 })]
    };
    expect(settledVideoIds(ledger).has("vid-1")).toBe(false);
  });

  // ...but not forever: a permanently broken download must stop eating the
  // scheduled run every single morning.
  it("settles a failure once it hits the attempt cap", () => {
    const ledger: IngestLedger = {
      lastScanAt: null,
      records: [record({ outcome: "error", attempts: MAX_INGEST_ATTEMPTS })]
    };
    expect(settledVideoIds(ledger).has("vid-1")).toBe(true);
    expect(abandonedRecords(ledger).map((entry) => entry.videoId)).toEqual(["vid-1"]);
  });

  it("does not report a successful ingest as abandoned", () => {
    const ledger: IngestLedger = {
      lastScanAt: null,
      records: [record({ outcome: "ready", attempts: MAX_INGEST_ATTEMPTS })]
    };
    expect(abandonedRecords(ledger)).toEqual([]);
  });
});

describe("attemptsFor", () => {
  it("starts at zero and reports what has been spent", () => {
    const ledger: IngestLedger = { lastScanAt: null, records: [record({ attempts: 2 })] };
    expect(attemptsFor(ledger, "vid-1")).toBe(2);
    expect(attemptsFor(ledger, "unknown")).toBe(0);
  });
});
