import { describe, expect, it } from "vitest";
import type { PipelineRun } from "@/lib/pipeline/types";
import { runwayIssues, shortStreamName, shortsRunway, tiktokInboxWall, unbookedStreams } from "@/lib/publisher/runway";
import { testItem } from "@/lib/publisher/test-helpers";
import type { PlatformStatus, QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-11-17T12:00:00.000Z");

function item(id: string, publishAt: string, legs: Record<string, PlatformStatus>, extra: Partial<QueueItem> = {}): QueueItem {
  return testItem({
    id,
    publishAt,
    platforms: Object.fromEntries(Object.entries(legs).map(([platform, status]) => [platform, { status, attempts: 0 }])),
    ...extra
  });
}

function run(id: string, createdAt: string, extra: Partial<PipelineRun> = {}): PipelineRun {
  return { id, name: `Vibe Coding Until I Can Move Out - Day ${id}`, status: "running", notices: [], createdAt, clipJobId: `job-${id}`, ...extra } as PipelineRun;
}

describe("shortsRunway", () => {
  it("counts only short video legs that will still post inside the window", () => {
    const queue = [
      item("a", "2026-11-18T15:00:00.000Z", { youtube: "pending", instagram: "pending" }),
      item("b", "2026-11-19T15:00:00.000Z", { youtube: "published", instagram: "failed" }),
      item("c", "2026-11-16T15:00:00.000Z", { youtube: "pending" }),
      item("d", "2026-11-30T15:00:00.000Z", { youtube: "pending" }),
      item("e", "2026-11-20T15:00:00.000Z", { youtube: "pending" }, { format: "long" }),
      item("f", "2026-11-20T15:00:00.000Z", { instagram: "pending" }, { mediaKind: "image" })
    ];
    expect(shortsRunway(queue, ["youtube", "instagram"], 3, NOW)).toEqual([
      { platform: "youtube", booked: 2, expected: 21 },
      { platform: "instagram", booked: 1, expected: 21 }
    ]);
  });
});

describe("tiktokInboxWall", () => {
  const full = [
    ...Array.from({ length: 10 }, (_, i) => item(`s${i}`, "2026-09-01T15:00:00.000Z", { tiktok: "scheduled" })),
    item("p1", "2026-08-22T21:30:00.000Z", { tiktok: "pending" }),
    item("p2", "2026-11-18T00:30:00.000Z", { tiktok: "pending" })
  ];

  it("reports the wall when the inbox is at its limit and posts are waiting", () => {
    expect(tiktokInboxWall(full, 10, true)).toEqual({ drafts: 10, limit: 10, stuck: 2, oldestAt: "2026-08-22T21:30:00.000Z" });
  });

  it("is quiet with room in the inbox, with nothing waiting, or through a relay", () => {
    expect(tiktokInboxWall(full, 11, true)).toBeNull();
    expect(tiktokInboxWall(full.slice(0, 10), 10, true)).toBeNull();
    expect(tiktokInboxWall(full, 10, false)).toBeNull();
  });
});

describe("unbookedStreams", () => {
  it("lists recent runs with clips and no queue item, oldest first", () => {
    const runs = [
      run("98", "2026-11-13T10:00:00.000Z"),
      run("97", "2026-11-12T10:00:00.000Z"),
      run("96", "2026-11-11T10:00:00.000Z"),
      run("old", "2026-10-01T10:00:00.000Z"),
      run("err", "2026-11-12T10:00:00.000Z", { status: "error" }),
      run("disk", "2026-11-06T10:00:00.000Z", { failures: { clips: 3 } }),
      run("noclips", "2026-11-12T10:00:00.000Z", { clipJobId: undefined })
    ];
    const queue = [item("q", "2026-11-20T15:00:00.000Z", { youtube: "pending" }, { runId: "96" })];
    expect(unbookedStreams(runs, queue, NOW).map((entry) => entry.runId)).toEqual(["97", "98"]);
  });
});

describe("shortStreamName", () => {
  it("keeps the day number of a series title and trims anything else", () => {
    expect(shortStreamName("Vibe Coding Until I Can Move Out of My Mom's Basement - Day 98")).toBe("Day 98");
    expect(shortStreamName("I love Fable 5.2 | Vibe Coding Until I Can Move Out - Day  96")).toBe("Day 96");
    expect(shortStreamName("Testing Fable 5.2 in my mom's basement")).toBe("Testing Fable 5.2 in my mom's...");
  });
});

describe("runwayIssues", () => {
  const base = { platforms: ["youtube", "instagram", "tiktok"] as const, shortsPerDay: 3, timezone: "America/Toronto", tiktokInboxLimit: 10, tiktokViaInbox: true };

  it("says nothing when every platform is booked and nothing is stuck", () => {
    const queue = Array.from({ length: 21 }, (_, i) =>
      item(`k${i}`, new Date(NOW.getTime() + (i + 1) * 7 * 3_600_000).toISOString(), { youtube: "pending", instagram: "pending", tiktok: "pending" })
    );
    expect(runwayIssues({ ...base, platforms: [...base.platforms], queue, runs: [] }, NOW)).toEqual([]);
  });

  it("names the TikTok wall, the thin runway and the streams waiting to be booked", () => {
    const queue = [
      ...Array.from({ length: 12 }, (_, i) => item(`s${i}`, "2026-09-01T15:00:00.000Z", { tiktok: "scheduled" })),
      item("p1", "2026-08-22T21:30:00.000Z", { tiktok: "pending" }),
      item("ig", "2026-11-18T15:00:00.000Z", { instagram: "pending", youtube: "published" })
    ];
    const runs = ["92", "95", "96", "97", "98"].map((day, i) => run(day, `2026-11-0${i + 4}T10:00:00.000Z`));
    const issues = runwayIssues({ ...base, platforms: [...base.platforms], queue, runs }, NOW);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toBe(
      "TikTok is holding too many unfinished drafts (12 of 10), so 1 TikTok posts are stuck, the oldest since Aug 22. Post or discard the drafts in the TikTok app; nothing new reaches TikTok until then."
    );
    expect(issues[1]).toBe("Shorts booked for the next 7 days: YouTube 1 of 21, Instagram 1 of 21. The schedule is running dry.");
    expect(issues[2]).toBe(
      "5 recent streams have clips made and nothing booked: Day 92, Day 95, Day 96, Day 97 and 1 more. Open each on the Pipeline page and schedule its outputs."
    );
  });
});
