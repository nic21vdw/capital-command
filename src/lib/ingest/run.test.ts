import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The orchestration's safety properties, which the pure decision tests can't
 * reach: a broken publish-queue read must stop the scan rather than let it
 * ingest blind, and an unconfigured channel must report rather than throw.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/publisher/queue");
  vi.doUnmock("@/lib/ingest/channelScan");
  vi.doUnmock("@/lib/ingest/ledger");
});

const anUpload = {
  videoId: "car-1",
  title: "Yapping in the car",
  publishedAt: "2026-07-26T08:00:00.000Z",
  durationSec: 664,
  aspect: { width: 480, height: 270 },
  wasLiveStream: false,
  privacyStatus: "public",
  url: "https://www.youtube.com/watch?v=car-1"
};

function mockScan(uploads: unknown[]) {
  vi.doMock("@/lib/ingest/channelScan", () => ({
    scanChannelUploads: vi.fn(async () => ({
      configured: true,
      needsReconnect: false,
      channelId: "UCabc",
      uploads
    }))
  }));
}

function mockLedger() {
  vi.doMock("@/lib/ingest/ledger", () => ({
    readLedger: vi.fn(async () => ({ lastScanAt: null, records: [] })),
    writeLedger: vi.fn(async () => undefined),
    settledVideoIds: () => new Set<string>(),
    attemptsFor: () => 0,
    abandonedRecords: () => [],
    MAX_INGEST_ATTEMPTS: 3
  }));
}

describe("runDailyScan", () => {
  // The important one. An empty set on a failed read would look like "nothing
  // was ever published" and let the pipeline re-ingest its own Shorts.
  it("refuses to ingest when the publish queue cannot be read", async () => {
    mockScan([anUpload]);
    mockLedger();
    vi.doMock("@/lib/publisher/queue", () => ({
      publishQueue: () => ({
        list: async () => {
          throw new Error("R2 credentials missing");
        }
      })
    }));

    const { runDailyScan } = await import("@/lib/ingest/run");
    await expect(runDailyScan({ dryRun: true })).rejects.toThrow(/Refusing to ingest/);
  });

  it("says so when provenance has nothing to match against", async () => {
    mockScan([anUpload]);
    mockLedger();
    vi.doMock("@/lib/publisher/queue", () => ({
      publishQueue: () => ({ list: async () => [] })
    }));

    const messages: string[] = [];
    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({ dryRun: true, log: (message) => messages.push(message) });

    expect(messages.join("\n")).toMatch(/shape alone/);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].decision.action).toBe("ingest");
  });

  it("matches provenance from the queue and skips the app's own upload", async () => {
    mockScan([anUpload]);
    mockLedger();
    vi.doMock("@/lib/publisher/queue", () => ({
      publishQueue: () => ({
        list: async () => [
          { id: "q1", platforms: { youtube: { status: "published", postId: "car-1", attempts: 1 } } }
        ]
      })
    }));

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({ dryRun: true });
    expect(report.candidates[0].decision).toEqual({
      action: "skip",
      reason: "published-by-distribution-centre"
    });
    expect(report.ingested).toEqual([]);
  });

  it("a dry run takes nothing in", async () => {
    mockScan([anUpload]);
    mockLedger();
    vi.doMock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => [] }) }));
    const ledger = await import("@/lib/ingest/ledger");

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.ingested).toEqual([]);
    expect(vi.mocked(ledger.writeLedger)).not.toHaveBeenCalled();
  });

  it("reports an unconfigured channel instead of throwing", async () => {
    vi.doMock("@/lib/ingest/channelScan", () => ({
      scanChannelUploads: vi.fn(async () => ({
        configured: false,
        needsReconnect: false,
        channelId: null,
        uploads: []
      }))
    }));
    mockLedger();
    vi.doMock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => [] }) }));

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});
    expect(report).toMatchObject({ configured: false, candidates: [], ingested: [] });
  });

  it("surfaces the reconnect case without ingesting", async () => {
    vi.doMock("@/lib/ingest/channelScan", () => ({
      scanChannelUploads: vi.fn(async () => ({
        configured: true,
        needsReconnect: true,
        channelId: "UCabc",
        uploads: []
      }))
    }));
    mockLedger();
    vi.doMock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => [] }) }));

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});
    expect(report).toMatchObject({ needsReconnect: true, ingested: [] });
  });
});
