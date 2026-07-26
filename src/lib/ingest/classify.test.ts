import { describe, expect, it } from "vitest";
import { decideUpload, isVertical, parseIso8601Duration, SHORT_MAX_SECONDS } from "@/lib/ingest/classify";
import type { ChannelUpload } from "@/lib/ingest/types";

/**
 * The rules that decide what enters the distribution pipeline. The expensive
 * mistake is re-ingesting the pipeline's own Shorts, so most of this is about
 * the two guards against that.
 */

function upload(overrides: Partial<ChannelUpload> = {}): ChannelUpload {
  return {
    videoId: "vid-1",
    title: "Some video",
    publishedAt: "2026-07-26T10:00:00.000Z",
    durationSec: 1800,
    aspect: { width: 480, height: 270 },
    wasLiveStream: false,
    privacyStatus: "public",
    url: "https://www.youtube.com/watch?v=vid-1",
    ...overrides
  };
}

const nothingSeen = { publishedPostIds: new Set<string>(), ingestedVideoIds: new Set<string>() };

describe("parseIso8601Duration", () => {
  it("reads the shapes YouTube actually returns", () => {
    expect(parseIso8601Duration("PT30S")).toBe(30);
    expect(parseIso8601Duration("PT2M")).toBe(120);
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("PT3H")).toBe(10800);
    expect(parseIso8601Duration("P1DT2H")).toBe(93600);
    expect(parseIso8601Duration("PT1M30.5S")).toBe(90.5);
  });

  // 0 means "unknown". If it meant "instant" instead, an unreadable duration
  // would look like a Short and real content would be skipped.
  it("returns 0 rather than guessing", () => {
    expect(parseIso8601Duration(undefined)).toBe(0);
    expect(parseIso8601Duration(null)).toBe(0);
    expect(parseIso8601Duration("")).toBe(0);
    expect(parseIso8601Duration("nonsense")).toBe(0);
    expect(parseIso8601Duration("P0D")).toBe(0);
  });
});

describe("isVertical", () => {
  it("only says yes when the frame is genuinely taller than wide", () => {
    expect(isVertical({ width: 270, height: 480 })).toBe(true);
    expect(isVertical({ width: 480, height: 270 })).toBe(false);
    // Square is not vertical — nothing is shot square, so this is bad data.
    expect(isVertical({ width: 480, height: 480 })).toBe(false);
  });

  it("treats missing or nonsense dimensions as unknown, not vertical", () => {
    expect(isVertical(null)).toBe(false);
    expect(isVertical({ width: 0, height: 480 })).toBe(false);
    expect(isVertical({ width: 480, height: 0 })).toBe(false);
    expect(isVertical({ width: -1, height: 480 })).toBe(false);
  });
});

describe("decideUpload", () => {
  it("takes in a long-form upload", () => {
    expect(decideUpload(upload(), nothingSeen)).toEqual({ action: "ingest", reason: "long-form-upload" });
  });

  it("takes in a live stream VOD", () => {
    const decision = decideUpload(upload({ wasLiveStream: true, durationSec: 7200 }), nothingSeen);
    expect(decision).toEqual({ action: "ingest", reason: "live-stream" });
  });

  // The whole point: the pipeline's own Shorts must not come back in.
  it("skips anything this app published, by exact postId match", () => {
    const seen = { publishedPostIds: new Set(["vid-1"]), ingestedVideoIds: new Set<string>() };
    expect(decideUpload(upload(), seen)).toEqual({
      action: "skip",
      reason: "published-by-distribution-centre"
    });
  });

  // Provenance beats shape: a horizontal long-form video the app published is
  // still the app's own output and must not be re-ingested.
  it("trusts the postId match over the video looking like fresh content", () => {
    const seen = { publishedPostIds: new Set(["vid-1"]), ingestedVideoIds: new Set<string>() };
    const decision = decideUpload(
      upload({ durationSec: 3600, aspect: { width: 480, height: 270 }, wasLiveStream: true }),
      seen
    );
    expect(decision.action).toBe("skip");
  });

  it("skips what an earlier scan already took in", () => {
    const seen = { publishedPostIds: new Set<string>(), ingestedVideoIds: new Set(["vid-1"]) };
    expect(decideUpload(upload(), seen)).toEqual({ action: "skip", reason: "already-ingested" });
  });

  it("skips a hand-posted Short on shape alone", () => {
    const decision = decideUpload(
      upload({ durationSec: 45, aspect: { width: 270, height: 480 } }),
      nothingSeen
    );
    expect(decision).toEqual({ action: "skip", reason: "short-vertical" });
  });

  it("uses three minutes as the cutoff", () => {
    const vertical = { width: 270, height: 480 };
    expect(decideUpload(upload({ durationSec: SHORT_MAX_SECONDS, aspect: vertical }), nothingSeen).action).toBe(
      "skip"
    );
    // A vertical video longer than a Short is real content — a phone-shot vlog.
    expect(
      decideUpload(upload({ durationSec: SHORT_MAX_SECONDS + 1, aspect: vertical }), nothingSeen)
    ).toEqual({ action: "ingest", reason: "long-form-upload" });
  });

  it("takes in a short horizontal video — brevity alone is not a Short", () => {
    const decision = decideUpload(
      upload({ durationSec: 90, aspect: { width: 480, height: 270 } }),
      nothingSeen
    );
    expect(decision).toEqual({ action: "ingest", reason: "long-form-upload" });
  });

  // Conservative: holding it back is recoverable by hand, re-clipping a Short is
  // the loop this exists to prevent. It must be flagged, not silently dropped.
  it("holds back a short video whose shape could not be read, and flags it", () => {
    const decision = decideUpload(upload({ durationSec: 40, aspect: null }), nothingSeen);
    expect(decision).toEqual({
      action: "skip",
      reason: "probable-short-unknown-aspect",
      needsReview: true
    });
  });

  it("still takes in a long video whose shape could not be read", () => {
    expect(decideUpload(upload({ durationSec: 3600, aspect: null }), nothingSeen).action).toBe("ingest");
  });

  // An unknown duration must not be read as 0 seconds and skipped as a Short.
  it("takes in a video with an unreadable duration", () => {
    expect(decideUpload(upload({ durationSec: 0, aspect: null }), nothingSeen).action).toBe("ingest");
  });

  it("leaves drafts alone", () => {
    for (const privacyStatus of ["private", "unlisted", "unknown"]) {
      expect(decideUpload(upload({ privacyStatus }), nothingSeen)).toEqual({
        action: "skip",
        reason: "not-public"
      });
    }
  });

  // A private video the app scheduled is caught by provenance before privacy,
  // which keeps the reported reason the accurate one.
  it("reports provenance rather than privacy for a scheduled post", () => {
    const seen = { publishedPostIds: new Set(["vid-1"]), ingestedVideoIds: new Set<string>() };
    expect(decideUpload(upload({ privacyStatus: "private" }), seen).reason).toBe(
      "published-by-distribution-centre"
    );
  });
});
