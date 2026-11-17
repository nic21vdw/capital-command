import { describe, expect, it } from "vitest";
import type { RunBacklog } from "@/lib/pipeline/shortsBacklog";
import { heldFrom, HOLD_EVERYTHING, DEFAULT_REVIEW_POLICY } from "@/lib/publisher/approval";
import { legWillPost, runwayIssues, shortStreamName, shortsRunway, tiktokInboxWall } from "@/lib/publisher/runway";
import { testItem } from "@/lib/publisher/test-helpers";
import type { PlatformId, PlatformStatus, QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const SOON = "2026-11-18T15:00:00.000Z";
const PAST = "2026-11-16T15:00:00.000Z";

function item(id: string, publishAt: string, legs: Record<string, PlatformStatus>, extra: Partial<QueueItem> = {}): QueueItem {
  return testItem({
    id,
    publishAt,
    platforms: Object.fromEntries(Object.entries(legs).map(([platform, status]) => [platform, { status, attempts: 0 }])),
    ...extra
  });
}

describe("legWillPost", () => {
  const cases: [PlatformId, PlatformStatus, string, Partial<QueueItem>, boolean, boolean][] = [
    ["youtube", "pending", SOON, {}, false, true],
    ["instagram", "uploaded", SOON, {}, false, true],
    ["facebook", "scheduled", SOON, {}, false, true],
    ["youtube", "published", SOON, {}, false, true],
    ["youtube", "published", PAST, {}, false, false],
    ["facebook", "published", SOON, {}, false, false],
    ["instagram", "published", SOON, {}, false, false],
    ["tiktok", "published", SOON, {}, false, false],
    ["tiktok", "scheduled", SOON, {}, false, false],
    ["tiktok", "scheduled", SOON, { tiktok: { delivery: "direct" } as QueueItem["tiktok"] }, false, true],
    ["tiktok", "scheduled", SOON, {}, true, true],
    ["youtube", "failed", SOON, {}, false, false],
    ["instagram", "manual", SOON, {}, false, false]
  ];
  it.each(cases)("%s %s at %s (%o, relay %s) -> %s", (platform, status, publishAt, extra, relayOn, expected) => {
    const queued = item("x", publishAt, { [platform]: status }, extra);
    expect(legWillPost(queued, platform, queued.platforms[platform]!, NOW.getTime(), relayOn)).toBe(expected);
  });
});

describe("shortsRunway", () => {
  it("counts only short video legs that will still post inside the window", () => {
    const queue = [
      item("a", "2026-11-18T15:00:00.000Z", { youtube: "pending", instagram: "pending" }),
      item("b", "2026-11-19T15:00:00.000Z", { youtube: "published", instagram: "failed" }),
      item("c", PAST, { youtube: "pending" }),
      item("d", "2026-11-30T15:00:00.000Z", { youtube: "pending" }),
      item("e", "2026-11-20T15:00:00.000Z", { youtube: "pending" }, { format: "long" }),
      item("f", "2026-11-20T15:00:00.000Z", { instagram: "pending" }, { mediaKind: "image" })
    ];
    expect(shortsRunway(queue, ["youtube", "instagram"], 3, NOW)).toEqual([
      { platform: "youtube", booked: 2, held: 0, expected: 21 },
      { platform: "instagram", booked: 1, held: 0, expected: 21 }
    ]);
  });

  it("splits legs waiting for approval from legs that will go out on their own", () => {
    const queue = [item("a", SOON, { youtube: "pending", instagram: "pending" })];
    expect(shortsRunway(queue, ["youtube"], 1, NOW, { held: heldFrom(HOLD_EVERYTHING) })[0]).toMatchObject({ booked: 0, held: 1 });
    expect(shortsRunway(queue, ["youtube"], 1, NOW, { held: heldFrom(DEFAULT_REVIEW_POLICY) })[0]).toMatchObject({ booked: 1, held: 0 });
    const approved = item("b", SOON, { youtube: "pending" });
    approved.platforms.youtube!.approvedAt = NOW.toISOString();
    expect(shortsRunway([approved], ["youtube"], 1, NOW, { held: heldFrom(HOLD_EVERYTHING) })[0]).toMatchObject({ booked: 1, held: 0 });
  });

  it("does not count TikTok inbox drafts as booked, but does count a relay's", () => {
    const queue = [item("a", SOON, { tiktok: "scheduled" })];
    expect(shortsRunway(queue, ["tiktok"], 1, NOW)[0].booked).toBe(0);
    expect(shortsRunway(queue, ["tiktok"], 1, NOW, { relayOn: true })[0].booked).toBe(1);
  });
});

describe("tiktokInboxWall", () => {
  const drafts = (n: number, extra: Partial<QueueItem> = {}) =>
    Array.from({ length: n }, (_, i) => item(`s${i}${extra.tiktok ? "d" : ""}`, "2026-09-01T15:00:00.000Z", { tiktok: "scheduled" }, extra));
  const direct = { tiktok: { delivery: "direct" } as QueueItem["tiktok"] };

  it("reports the wall when inbox drafts reach the limit and inbox posts are waiting", () => {
    const queue = [...drafts(10), item("p1", "2026-08-22T21:30:00.000Z", { tiktok: "pending" }), item("p2", SOON, { tiktok: "pending" })];
    expect(tiktokInboxWall(queue, 10, false)).toEqual({ drafts: 10, limit: 10, stuck: 2, oldestAt: "2026-08-22T21:30:00.000Z" });
  });

  it("does not count direct posts as drafts or as stuck, the same as the runner", () => {
    const queue = [...drafts(9), ...drafts(5, direct), item("p1", SOON, { tiktok: "pending" }), item("pd", PAST, { tiktok: "pending" }, direct)];
    expect(tiktokInboxWall(queue, 10, false)).toBeNull();
    const full = [...drafts(10), ...drafts(5, direct), item("p1", SOON, { tiktok: "pending" }), item("pd", PAST, { tiktok: "pending" }, direct)];
    expect(tiktokInboxWall(full, 10, false)).toEqual({ drafts: 10, limit: 10, stuck: 1, oldestAt: SOON });
  });

  it("is quiet with room in the inbox, with only direct posts waiting, or through a relay", () => {
    const queue = [...drafts(10), item("p1", SOON, { tiktok: "pending" })];
    expect(tiktokInboxWall(queue, 11, false)).toBeNull();
    expect(tiktokInboxWall([...drafts(10), item("pd", SOON, { tiktok: "pending" }, direct)], 10, false)).toBeNull();
    expect(tiktokInboxWall(queue, 10, true)).toBeNull();
  });
});

describe("shortStreamName", () => {
  it("keeps the day number of a series title and trims anything else on a word", () => {
    expect(shortStreamName("Vibe Coding Until I Can Move Out of My Mom's Basement - Day 98")).toBe("Day 98");
    expect(shortStreamName("I love Fable 5.2 | Vibe Coding Until I Can Move Out - Day  96")).toBe("Day 96");
    expect(shortStreamName("Testing Fable 5.2 in my mom's basement")).toBe("Testing Fable 5.2 in my mom's...");
  });
});

function backlog(name: string, waiting: number): RunBacklog {
  return {
    runId: name, runName: `Stream - ${name}`, createdAt: NOW.toISOString(), ready: 10, booked: 10 - waiting, decided: 0,
    waiting: Array.from({ length: waiting }, (_, i) => ({ candidateId: `clip:${name}:${i}`, runId: name, runName: name, jobId: name, clipId: `${i}`, title: "t", score: 50, durationSec: 30, file: "f.mp4" }))
  };
}

describe("runwayIssues", () => {
  const base = { platforms: ["youtube", "instagram", "tiktok"] as PlatformId[], shortsPerDay: 3, timezone: "America/Toronto", tiktokInboxLimit: 10, tiktokRelayOn: false };

  it("says nothing when every platform is booked and nothing is waiting", () => {
    const queue = Array.from({ length: 21 }, (_, i) =>
      item(`k${i}`, new Date(NOW.getTime() + (i + 1) * 7 * 3_600_000).toISOString(), { youtube: "pending", instagram: "pending", tiktok: "pending" })
    );
    expect(runwayIssues({ ...base, queue, backlog: [backlog("Day 90", 0)] }, NOW)).toEqual([]);
  });

  it("names the TikTok wall, the thin runway and the Shorts waiting by stream", () => {
    const queue = [
      ...Array.from({ length: 12 }, (_, i) => item(`s${i}`, "2026-09-01T15:00:00.000Z", { tiktok: "scheduled" })),
      item("p1", "2026-08-22T21:30:00.000Z", { tiktok: "pending" }),
      item("ig", SOON, { instagram: "pending", youtube: "published" })
    ];
    const issues = runwayIssues({ ...base, queue, backlog: ["Day 92", "Day 95", "Day 96", "Day 97", "Day 98"].map((name, i) => backlog(name, i === 1 ? 3 : 10)) }, NOW);
    expect(issues).toEqual([
      "TikTok is holding too many unfinished drafts (12 of 10), so 1 TikTok posts are stuck, the oldest since Aug 22. Post or discard the drafts in the TikTok app; nothing new reaches TikTok until then.",
      "Shorts booked for the next 7 days: YouTube 1 of 21, Instagram 1 of 21. The schedule is running dry.",
      "43 finished Shorts are not booked yet, from 5 recent streams: Day 92 (10), Day 95 (3), Day 96 (10), Day 97 (10) and 1 more. Review them on Weekly Shorts Review."
    ]);
  });

  it("shows approval holds beside the booked count", () => {
    const queue = [item("a", SOON, { youtube: "pending" })];
    const [line] = runwayIssues({ ...base, platforms: ["youtube"], queue, backlog: [], held: heldFrom(HOLD_EVERYTHING) }, NOW);
    expect(line).toBe("Shorts booked for the next 7 days: YouTube 0 of 21 (+1 waiting for your approval). The schedule is running dry.");
  });
});
