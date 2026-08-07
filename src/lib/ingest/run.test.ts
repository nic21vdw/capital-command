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
  vi.doUnmock("@/lib/ingest/pipelineClient");
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

const aStream = {
  videoId: "stream-1",
  title: "Sunday build stream",
  publishedAt: "2026-07-26T08:00:00.000Z",
  durationSec: 10_800,
  aspect: { width: 1920, height: 1080 },
  wasLiveStream: true,
  privacyStatus: "public",
  url: "https://www.youtube.com/watch?v=stream-1"
};

/** A pipeline that accepts a stream and settles with a full fan-out. */
function mockPipeline(
  overrides: {
    start?: () => Promise<string>;
    wait?: () => Promise<unknown>;
  } = {}
) {
  const startPipelineRun = vi.fn(overrides.start ?? (async () => "run-1"));
  const waitForPipelineRun = vi.fn(
    overrides.wait ??
      (async () => ({
        outcome: "ready",
        overview: {
          run: { id: "run-1", longformProjectId: "proj-1" },
          schedulable: {
            clipsReady: 8,
            longformReady: true,
            audioReady: true,
            carouselSlides: 6,
            posts: 3,
            queued: 0
          }
        }
      }))
  );
  class AppUnreachableError extends Error {}
  const pipelineSourceVideoIds = vi.fn(async () => new Set<string>());
  vi.doMock("@/lib/ingest/pipelineClient", () => ({
    startPipelineRun,
    waitForPipelineRun,
    pipelineSourceVideoIds,
    appBaseUrl: () => "http://localhost:3000",
    appReachable: async () => true,
    AppUnreachableError
  }));
  return { startPipelineRun, waitForPipelineRun, pipelineSourceVideoIds, AppUnreachableError };
}

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
    recordScanOutcome: vi.fn(async () => undefined),
    settledVideoIds: () => new Set<string>(),
    attemptsFor: () => 0,
    abandonedRecords: () => [],
    upsertRecord: (ledger: { records: unknown[] }, record: unknown) => ({
      ...ledger,
      records: [...ledger.records, record]
    }),
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
    mockPipeline();
    vi.doMock("@/lib/publisher/queue", () => ({
      publishQueue: () => ({ list: async () => [] })
    }));

    const messages: string[] = [];
    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({
      dryRun: true,
      liveOnly: false,
      log: (message) => messages.push(message)
    });

    expect(messages.join("\n")).toMatch(/shape alone/);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].decision.action).toBe("ingest");
  });

  it("matches provenance from the queue and skips the app's own upload", async () => {
    mockScan([anUpload]);
    mockLedger();
    mockPipeline();
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
    mockPipeline();
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

describe("running a stream through the pipeline", () => {
  function setup() {
    mockLedger();
    vi.doMock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ list: async () => [] }) }));
  }

  it("hands a new live stream to the pipeline and records what it produced", async () => {
    mockScan([aStream]);
    setup();
    const pipeline = mockPipeline();

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});

    expect(pipeline.startPipelineRun).toHaveBeenCalledWith(aStream.url, aStream.title);
    expect(report.ingested).toHaveLength(1);
    expect(report.ingested[0]).toMatchObject({
      videoId: "stream-1",
      runId: "run-1",
      projectId: "proj-1",
      outcome: "ready",
      outputs: { clipsReady: 8, longformReady: true, audioReady: true, carouselSlides: 6, posts: 3 }
    });
  });

  // The whole point of the scheduled run: it must not stop at a long-form
  // project the way the first version did.
  it("waits for the run to settle rather than returning once it starts", async () => {
    mockScan([aStream]);
    setup();
    const pipeline = mockPipeline();

    const { runDailyScan } = await import("@/lib/ingest/run");
    await runDailyScan({});

    expect(pipeline.waitForPipelineRun).toHaveBeenCalledOnce();
    expect(pipeline.waitForPipelineRun).toHaveBeenCalledWith(
      "run-1",
      expect.any(Number),
      expect.any(Number),
      expect.any(Function)
    );
  });

  it("leaves ordinary uploads alone by default", async () => {
    mockScan([anUpload]);
    setup();
    const pipeline = mockPipeline();

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});

    expect(report.candidates[0].decision).toEqual({ action: "skip", reason: "not-a-live-stream" });
    expect(pipeline.startPipelineRun).not.toHaveBeenCalled();
  });

  it("takes ordinary uploads too when asked", async () => {
    mockScan([anUpload]);
    setup();
    const pipeline = mockPipeline();

    const { runDailyScan } = await import("@/lib/ingest/run");
    await runDailyScan({ liveOnly: false });

    expect(pipeline.startPipelineRun).toHaveBeenCalledWith(anUpload.url, anUpload.title);
  });

  // A timeout means "still going", not "failed" — the ledger must leave it
  // unsettled so tomorrow re-checks instead of re-downloading.
  it("records a still-running pipeline as a timeout, not a success", async () => {
    mockScan([aStream]);
    setup();
    mockPipeline({ wait: async () => ({ outcome: "timeout" }) });

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});

    expect(report.ingested[0]).toMatchObject({ outcome: "timeout", runId: "run-1" });
    expect(report.ingested[0].outputs).toBeUndefined();
  });

  it("does not re-ingest a stream that is already a pipeline run's source", async () => {
    mockScan([aStream]);
    setup();
    const pipeline = mockPipeline();
    pipeline.pipelineSourceVideoIds.mockResolvedValue(new Set(["stream-1"]));

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});

    expect(report.candidates[0].decision).toEqual({ action: "skip", reason: "already-in-the-pipeline" });
    expect(pipeline.startPipelineRun).not.toHaveBeenCalled();
  });

  // Losing this read is not fatal — provenance and the ledger still stand — but
  // it must be said, because the consequence is an expensive re-download.
  it("warns but carries on when the pipeline runs cannot be read", async () => {
    mockScan([aStream]);
    setup();
    const pipeline = mockPipeline();
    pipeline.pipelineSourceVideoIds.mockRejectedValue(new Error("boom"));

    const messages: string[] = [];
    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({ log: (message) => messages.push(message) });

    expect(messages.join("\n")).toMatch(/could not read existing pipeline runs/i);
    expect(report.ingested).toHaveLength(1);
  });

  // Nic titles by day and streams more than once a day, so two sessions can
  // share a title and still be different content. Both must be taken in.
  it("takes in two same-titled streams as separate content", async () => {
    mockScan([
      aStream,
      { ...aStream, videoId: "stream-1b", durationSec: 14_041, url: "https://youtu.be/stream-1b" }
    ]);
    setup();
    const pipeline = mockPipeline();

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});

    expect(report.candidates.every((c) => c.decision.action === "ingest")).toBe(true);
    expect(pipeline.startPipelineRun).toHaveBeenCalledTimes(2);
  });

  // A failure after the run started must not lose which run it was, or the
  // pipeline holds a run nobody can trace back to the video that made it.
  it("keeps the run id when the wait fails after the run started", async () => {
    mockScan([aStream]);
    setup();
    mockPipeline({
      wait: async () => {
        throw new Error("500 Internal Server Error");
      }
    });

    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({});

    expect(report.ingested[0]).toMatchObject({ outcome: "error", runId: "run-1" });
  });

  it("stops the whole scan when the app is unreachable", async () => {
    mockScan([aStream, { ...aStream, videoId: "stream-2", url: "https://youtu.be/stream-2" }]);
    setup();

    class AppUnreachableError extends Error {}
    const startPipelineRun = vi.fn(async () => {
      throw new AppUnreachableError("app is down");
    });
    vi.doMock("@/lib/ingest/pipelineClient", () => ({
      startPipelineRun,
      waitForPipelineRun: vi.fn(),
      pipelineSourceVideoIds: async () => new Set<string>(),
      appBaseUrl: () => "http://localhost:3000",
      appReachable: async () => false,
      AppUnreachableError
    }));

    const messages: string[] = [];
    const { runDailyScan } = await import("@/lib/ingest/run");
    const report = await runDailyScan({ log: (message) => messages.push(message) });

    // One attempt burned, not one per stream.
    expect(startPipelineRun).toHaveBeenCalledOnce();
    expect(report.ingested).toHaveLength(1);
    expect(report.ingested[0].outcome).toBe("error");
    expect(messages.join("\n")).toMatch(/not reachable/);
  });
});
