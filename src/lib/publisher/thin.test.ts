import { describe, expect, it } from "vitest";
import { MemoryQueueStore, testConfig, testItem } from "@/lib/publisher/test-helpers";
import { PublishQueue } from "@/lib/publisher/queue";
import { buildGate, clipScoreIndex, planThin, planUnpark, REQUIRED_BUILD_COMMIT } from "@/lib/publisher/thin";
import type { QueueItem } from "@/lib/publisher/types";

const TZ = "America/Toronto";
const NOW = new Date("2026-10-01T16:00:00.000Z");

function short(id: string, publishAt: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return testItem({ id, publishAt, jobId: "job1", clipPath: `data\\clips\\outputs\\job1\\${id}-ready.mp4`, ...overrides });
}

describe("planThin", () => {
  it("keeps the two best-scored shorts a day and parks the rest", () => {
    const items = [
      short("a", "2026-10-05T12:00:00.000Z"),
      short("b", "2026-10-05T15:00:00.000Z"),
      short("c", "2026-10-05T18:00:00.000Z"),
      short("d", "2026-10-05T21:00:00.000Z")
    ];
    const scores = clipScoreIndex([
      {
        id: "job1",
        clips: [
          { score: 10, downloadFile: "a-ready.mp4" },
          { score: 90, downloadFile: "b-ready.mp4" },
          { score: 50, downloadFile: "c-ready.mp4" },
          { score: 20, downloadFile: "d-ready.mp4" }
        ]
      }
    ]);

    const plan = planThin(items, { now: NOW, timeZone: TZ, limit: 2, scores });

    expect(plan.days).toEqual([{ day: "2026-10-05", before: 4, after: 2, locked: 0, kept: ["b", "c"], parked: ["d", "a"] }]);
    expect(plan.park.map((item) => item.id)).toEqual(["d", "a"]);
  });

  it("keeps the earliest when nothing is scored", () => {
    const items = [
      short("late", "2026-10-05T21:00:00.000Z"),
      short("early", "2026-10-05T12:00:00.000Z"),
      short("middle", "2026-10-05T15:00:00.000Z")
    ];
    const plan = planThin(items, { now: NOW, timeZone: TZ, limit: 2 });
    expect(plan.days[0].kept).toEqual(["early", "middle"]);
    expect(plan.days[0].parked).toEqual(["late"]);
  });

  it("never parks a post a platform already holds, and counts it toward the day", () => {
    const items = [
      short("sent", "2026-10-05T12:00:00.000Z", {
        platforms: { youtube: { status: "published", attempts: 1, postId: "yt1" } }
      }),
      short("held", "2026-10-05T15:00:00.000Z", {
        platforms: { youtube: { status: "scheduled", attempts: 1, postId: "yt2" } }
      }),
      short("free", "2026-10-05T18:00:00.000Z")
    ];
    const plan = planThin(items, { now: NOW, timeZone: TZ, limit: 2 });
    expect(plan.days[0]).toMatchObject({ locked: 2, kept: [], parked: ["free"] });
  });

  it("leaves days that are over the limit only because of locked posts as they are", () => {
    const locked = (id: string, at: string) =>
      short(id, at, { platforms: { youtube: { status: "scheduled", attempts: 1, postId: id } } });
    const plan = planThin(
      [locked("x", "2026-10-05T12:00:00.000Z"), locked("y", "2026-10-05T15:00:00.000Z"), locked("z", "2026-10-05T18:00:00.000Z")],
      { now: NOW, timeZone: TZ, limit: 2 }
    );
    expect(plan.park).toHaveLength(0);
    expect(plan.days[0].after).toBe(3);
  });

  it("never touches anything dated before now", () => {
    const items = [
      short("past1", "2026-10-01T12:00:00.000Z"),
      short("past2", "2026-10-01T13:00:00.000Z"),
      short("past3", "2026-10-01T14:00:00.000Z"),
      short("later", "2026-10-01T22:00:00.000Z"),
      short("yesterday", "2026-09-30T15:00:00.000Z")
    ];
    const plan = planThin(items, { now: NOW, timeZone: TZ, limit: 2 });
    expect(plan.park.map((item) => item.id)).toEqual(["later"]);
    expect(plan.days.map((day) => day.day)).toEqual(["2026-10-01"]);
  });

  it("does not count long-form or picture posts", () => {
    const items = [
      short("a", "2026-10-05T12:00:00.000Z"),
      short("b", "2026-10-05T15:00:00.000Z"),
      short("long", "2026-10-05T18:00:00.000Z", { format: "long" }),
      short("deck", "2026-10-05T21:00:00.000Z", { mediaKind: "image" })
    ];
    const plan = planThin(items, { now: NOW, timeZone: TZ, limit: 2 });
    expect(plan.park).toHaveLength(0);
    expect(plan.days[0].before).toBe(2);
  });
});

describe("planUnpark", () => {
  const parked = {
    parked: [
      { parkedAt: "x", reason: "r", item: short("future", "2026-10-09T12:00:00.000Z") },
      { parkedAt: "x", reason: "r", item: short("gone", "2026-09-20T12:00:00.000Z") },
      { parkedAt: "x", reason: "r", item: short("live", "2026-10-09T15:00:00.000Z") }
    ]
  };

  it("restores future posts, keeps past ones parked, and skips ids already live", () => {
    const plan = planUnpark(parked, new Set(["live"]), { now: NOW });
    expect(plan.restore.map((item) => item.id)).toEqual(["future"]);
    expect(plan.stay.map((entry) => entry.item.id)).toEqual(["gone"]);
    expect(plan.skipped.map((skip) => skip.id)).toEqual(["gone", "live"]);
  });

  it("restores only the ids asked for", () => {
    const plan = planUnpark(parked, new Set(), { now: NOW, ids: ["live"] });
    expect(plan.restore.map((item) => item.id)).toEqual(["live"]);
    expect(plan.stay.map((entry) => entry.item.id)).toEqual(["future", "gone"]);
  });
});

describe("the parking round trip", () => {
  it("removes and re-adds posts with one save each", async () => {
    const store = new MemoryQueueStore();
    const queue = new PublishQueue(store, testConfig());
    await queue.add(short("a", "2026-10-05T12:00:00.000Z"));
    await queue.add(short("b", "2026-10-05T15:00:00.000Z"));
    const saves = store.saves;

    const removed = await queue.removeMany(["a", "b", "missing"]);
    expect(removed.map((item) => item.id)).toEqual(["a", "b"]);
    expect(store.saves).toBe(saves + 1);

    const added = await queue.addMany(removed);
    expect(added).toHaveLength(2);
    expect((await queue.list()).map((item) => item.id)).toEqual(["a", "b"]);
    expect(await queue.addMany(removed)).toHaveLength(0);
  });
});

describe("the build gate", () => {
  it("refuses without a build stamp", () => {
    const gate = buildGate("C:/app", () => undefined, () => null);
    expect(gate.ok).toBe(false);
  });

  it("refuses a build that does not contain the queue reload", () => {
    const gate = buildGate(
      "C:/app",
      () => {
        throw new Error("exit 1");
      },
      () => "2e4bc6d\n"
    );
    expect(gate).toMatchObject({ ok: false });
    expect(gate.ok ? "" : gate.reason).toContain(REQUIRED_BUILD_COMMIT);
  });

  it("allows a build that contains it, asking git the right question", () => {
    const calls: string[][] = [];
    const gate = buildGate("C:/app", (command, args) => void calls.push([command, ...args]), () => "f1aead1\n");
    expect(gate).toEqual({ ok: true, build: "f1aead1" });
    expect(calls).toEqual([["git", "merge-base", "--is-ancestor", REQUIRED_BUILD_COMMIT, "f1aead1"]]);
  });
});
