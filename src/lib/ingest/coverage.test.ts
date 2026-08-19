import { describe, expect, it } from "vitest";
import { channelCoverage, snapshotFromCandidates, type RunState } from "@/lib/ingest/coverage";
import { MAX_INGEST_ATTEMPTS } from "@/lib/ingest/ledger";
import type { ChannelUpload, IngestLedger, IngestRecord, ScanCandidate } from "@/lib/ingest/types";

const upload = (over: Partial<ChannelUpload>): ChannelUpload => ({
  videoId: "v1",
  title: "A stream",
  publishedAt: "2026-08-10T12:00:00.000Z",
  durationSec: 7200,
  aspect: { width: 1920, height: 1080 },
  wasLiveStream: true,
  isLiveNow: false,
  privacyStatus: "public",
  url: "https://youtu.be/v1",
  ...over
});

const candidate = (over: Partial<ChannelUpload>, decision: ScanCandidate["decision"]): ScanCandidate => ({
  upload: upload(over),
  decision
});

const record = (over: Partial<IngestRecord>): IngestRecord => ({
  videoId: "v1",
  title: "A stream",
  runId: "r1",
  projectId: null,
  ingestedAt: "2026-08-10T13:00:00.000Z",
  outcome: "ready",
  attempts: 1,
  ...over
});

const ledger = (over: Partial<IngestLedger>): IngestLedger => ({
  lastScanAt: "2026-08-12T10:00:00.000Z",
  records: [],
  ...over
});

describe("the picture of the channel a scan leaves behind", () => {
  it("keeps what Nic made and drops what the app posted", () => {
    const snapshot = snapshotFromCandidates(
      [
        candidate({ videoId: "stream" }, { action: "ingest", reason: "live-stream" }),
        candidate(
          { videoId: "car", wasLiveStream: false },
          { action: "skip", reason: "not-a-live-stream" }
        ),
        candidate({ videoId: "ours" }, { action: "skip", reason: "published-by-distribution-centre" }),
        candidate({ videoId: "short" }, { action: "skip", reason: "short-vertical" }),
        candidate({ videoId: "draft" }, { action: "skip", reason: "not-public" })
      ],
      "2026-08-12T10:00:00.000Z",
      7
    );
    expect(snapshot.videos.map((video) => video.videoId)).toEqual(["stream", "car"]);
    expect(snapshot.videos.map((video) => video.kind)).toEqual(["stream", "upload"]);
  });
});

describe("how far behind the channel the pipeline is", () => {
  const snapshot = {
    at: "2026-08-12T10:00:00.000Z",
    lookbackDays: 7,
    videos: [
      { videoId: "a", title: "A", publishedAt: "2026-08-09T12:00:00.000Z", kind: "stream" as const, url: "u/a" },
      { videoId: "b", title: "B", publishedAt: "2026-08-10T12:00:00.000Z", kind: "stream" as const, url: "u/b" },
      { videoId: "c", title: "C", publishedAt: "2026-08-11T12:00:00.000Z", kind: "upload" as const, url: "u/c" }
    ]
  };

  it("says nothing at all until a scan has looked", () => {
    expect(channelCoverage(ledger({}), new Map())).toBeNull();
  });

  it("counts each kind of video on its own", () => {
    const runs: RunState = new Map([["b", "working"]]);
    const coverage = channelCoverage(
      ledger({ channel: snapshot, records: [record({ videoId: "a" })] }),
      runs
    )!;
    expect(coverage.groups).toEqual([
      expect.objectContaining({ kind: "stream", total: 2, done: 1, working: 1, waiting: 0 }),
      expect.objectContaining({ kind: "upload", total: 1, done: 0, waiting: 1 })
    ]);
  });

  // A run that broke is the whole reason this panel is not just a count of
  // ledger rows: it is "taken in" and it is still work he has to do.
  it("lets a broken run speak for the video", () => {
    const coverage = channelCoverage(
      ledger({ channel: snapshot, records: [record({ videoId: "a", outcome: "error" })] }),
      new Map([["a", "attention"]])
    )!;
    expect(coverage.groups[0]).toMatchObject({ done: 0, attention: 1 });
  });

  it("treats a video the scan gave up on as needing a person", () => {
    const coverage = channelCoverage(
      ledger({
        channel: snapshot,
        records: [record({ videoId: "a", outcome: "timeout", attempts: MAX_INGEST_ATTEMPTS })]
      }),
      new Map()
    )!;
    expect(coverage.groups[0]).toMatchObject({ attention: 1 });
  });

  it("keeps a video still being retried as waiting, not as handled", () => {
    const coverage = channelCoverage(
      ledger({ channel: snapshot, records: [record({ videoId: "a", outcome: "timeout", attempts: 1 })] }),
      new Map()
    )!;
    expect(coverage.groups[0]).toMatchObject({ waiting: 2, done: 0 });
    expect(coverage.groups[0].outstanding.map((video) => video.videoId)).toEqual(["a", "b"]);
  });
});
