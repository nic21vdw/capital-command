import { describe, expect, it } from "vitest";
import { MAX_BRACKET_GAP_MS, metricsAtAge } from "@/lib/analytics/atAge";
import type { PostRecord } from "@/lib/analytics/types";

const HOUR = 3_600_000;
const PUBLISHED = Date.parse("2026-10-01T14:00:00.000Z");

function record(snapshots: Array<{ hoursAfter: number; metrics: Record<string, number> }>, overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    key: "youtube:v1",
    platform: "youtube",
    accountId: "youtube-primary",
    postId: "v1",
    itemId: "item-1",
    format: "video",
    title: "t",
    caption: "",
    publishedAt: new Date(PUBLISHED).toISOString(),
    status: "ok",
    latest: null,
    history: snapshots.map((entry) => {
      const at = new Date(PUBLISHED + entry.hoursAfter * HOUR).toISOString();
      return { date: at.slice(0, 10), at, ...entry.metrics };
    }),
    misses: 0,
    ...overrides
  };
}

describe("metricsAtAge", () => {
  it("returns the snapshot that lands exactly on the age", () => {
    const post = record([{ hoursAfter: 48, metrics: { views: 900, likes: 30 } }]);
    expect(metricsAtAge(post, 48 * HOUR)).toEqual({ views: 900, likes: 30 });
  });

  it("interpolates between the snapshots on either side of the age", () => {
    const post = record([
      { hoursAfter: 24, metrics: { views: 400, likes: 20 } },
      { hoursAfter: 72, metrics: { views: 1000, likes: 44 } }
    ]);
    expect(metricsAtAge(post, 48 * HOUR)).toEqual({ views: 700, likes: 32 });
  });

  it("counts from zero at the moment of publishing when the first snapshot is already past the age", () => {
    const post = record([{ hoursAfter: 96, metrics: { views: 960 } }]);
    expect(metricsAtAge(post, 48 * HOUR)).toEqual({ views: 480 });
  });

  it("is null while the post is younger than the age, because nothing has been read past it", () => {
    const post = record([{ hoursAfter: 30, metrics: { views: 300 } }]);
    expect(metricsAtAge(post, 48 * HOUR)).toBeNull();
  });

  it("is null when the surrounding snapshots are too far apart to say what happened in between", () => {
    const post = record([
      { hoursAfter: 10, metrics: { views: 100 } },
      { hoursAfter: 10 + MAX_BRACKET_GAP_MS / HOUR + 1, metrics: { views: 5000 } }
    ]);
    expect(metricsAtAge(post, 48 * HOUR)).toBeNull();
  });

  it("is null for a post whose only snapshot is far past the age", () => {
    const post = record([{ hoursAfter: 24 * 9, metrics: { views: 5000 } }]);
    expect(metricsAtAge(post, 48 * HOUR)).toBeNull();
  });

  it("is null for a post with no history", () => {
    expect(metricsAtAge(record([]), 48 * HOUR)).toBeNull();
  });

  it("leaves out a metric that only one side of the bracket reported", () => {
    const post = record([
      { hoursAfter: 24, metrics: { views: 400 } },
      { hoursAfter: 72, metrics: { views: 1000, watchMinutes: 90 } }
    ]);
    expect(metricsAtAge(post, 48 * HOUR)).toEqual({ views: 700 });
  });

  it("never treats the average view duration as a running total", () => {
    const post = record([{ hoursAfter: 96, metrics: { views: 960, avgViewSeconds: 12 } }]);
    expect(metricsAtAge(post, 48 * HOUR)).toEqual({ views: 480 });
  });

  it("reads a snapshot that has no timestamp as noon UTC of its day", () => {
    const post = record([]);
    post.history = [{ date: "2026-10-03", at: "", views: 600 }];
    expect(metricsAtAge(post, 46 * HOUR)).toEqual({ views: 600 });
  });
});
