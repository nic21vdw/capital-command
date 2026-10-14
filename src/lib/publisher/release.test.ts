import { describe, expect, it } from "vitest";
import { planRelease, type ReleaseOptions } from "@/lib/publisher/release";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-08-10T16:00:00.000Z");
const TIMEZONE = "America/Toronto";
const HOUR = 3_600_000;

const iso = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString();

const futureSlots = (days: number, times: string[] = ["11:30", "16:00"]) =>
  Array.from({ length: days }, (_, day) =>
    times.map((time) => {
      const date = new Date(Date.UTC(2026, 7, 11 + day));
      const [hour, minute] = time.split(":").map(Number);
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour + 4, minute)).toISOString();
    })
  ).flat();

const options = (over: Partial<ReleaseOptions> = {}): ReleaseOptions => ({
  now: NOW,
  timeZone: TIMEZONE,
  slots: futureSlots(10),
  dailyCap: () => 2,
  maxSlotAgeMs: 24 * HOUR,
  ...over
});

const leg = (over: Partial<PlatformState> = {}): PlatformState => ({ status: "pending", attempts: 0, ...over });

const post = (id: string, publishAt: string, platforms: Partial<Record<PlatformId, PlatformState>>, over: Partial<QueueItem> = {}): QueueItem =>
  ({
    id,
    clipPath: `data/clips/outputs/job/${id}.mp4`,
    title: id,
    caption: "",
    hashtags: [],
    publishAt,
    visibility: "public",
    createdAt: "2026-08-01T00:00:00.000Z",
    platforms,
    ...over
  }) as QueueItem;

const target = (id: string, platform: PlatformId = "instagram") => ({ id, platform });

describe("planRelease", () => {
  it("releases a leg with a slot still ahead exactly where it is", () => {
    const items = [post("a", iso(30), { instagram: leg() })];
    const plan = planRelease(items, [target("a")], options());
    expect(plan.release).toEqual([target("a")]);
    expect(plan.moves).toEqual([]);
  });

  it("releases a leg whose slot passed within the age limit where it is", () => {
    const items = [post("a", iso(-3), { instagram: leg() })];
    const plan = planRelease(items, [target("a")], options());
    expect(plan.release).toEqual([target("a")]);
    expect(plan.moves).toEqual([]);
  });

  it("treats a slot exactly at the age limit as still fresh, like a re-arm does", () => {
    const items = [post("a", iso(-24), { instagram: leg() })];
    expect(planRelease(items, [target("a")], options()).moves).toEqual([]);
  });

  it("moves a leg whose slot is older than the limit to the next free slot", () => {
    const items = [post("a", iso(-30), { instagram: leg() })];
    const plan = planRelease(items, [target("a")], options());
    expect(plan.release).toEqual([target("a")]);
    expect(plan.moves).toEqual([{ ...target("a"), publishAt: futureSlots(1)[0], reason: "slot-too-old" }]);
  });

  it("never releases more than the daily cap in one burst; the excess goes to later days", () => {
    const items = ["a", "b", "c", "d", "e"].map((id, index) => post(id, iso(-1 - index * 0.1), { instagram: leg() }));
    const plan = planRelease(items, items.map((item) => target(item.id)), options());
    const inPlace = plan.release.filter((entry) => !plan.moves.some((move) => move.id === entry.id));
    expect(inPlace).toHaveLength(2);
    expect(plan.moves).toHaveLength(3);
    expect(plan.moves.every((move) => move.reason === "day-full")).toBe(true);
    const perDay = new Map<string, number>();
    for (const move of plan.moves) {
      const day = move.publishAt.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
    expect(new Set(plan.moves.map((move) => move.publishAt)).size).toBe(3);
  });

  it("counts what already went out today against the cap", () => {
    const items = [
      post("sent", iso(-2), { instagram: leg({ status: "published", postId: "1", attempts: 1 }) }),
      post("a", iso(-1), { instagram: leg() }),
      post("b", iso(-0.5), { instagram: leg() })
    ];
    const plan = planRelease(items, [target("a"), target("b")], options());
    expect(plan.moves.map((move) => move.id)).toEqual(["b"]);
  });

  it("keeps each platform's cap separate", () => {
    const items = [
      post("a", iso(-1), { instagram: leg(), facebook: leg() }),
      post("b", iso(-1.2), { instagram: leg(), facebook: leg() })
    ];
    const plan = planRelease(items, [target("a"), target("b"), target("a", "facebook"), target("b", "facebook")], options());
    expect(plan.moves).toEqual([]);
  });

  it("counts one video once per platform even when it has several legs on that day", () => {
    const items = [post("a", iso(-1), { instagram: leg() }, { clipPath: "data/clips/outputs/job/shared.mp4" })];
    const sibling = post("b", iso(-1), { instagram: leg() }, { clipPath: "data/clips/outputs/job/shared.mp4" });
    const plan = planRelease([...items, sibling], [target("a"), target("b")], options({ dailyCap: () => 1 }));
    expect(plan.moves).toEqual([]);
  });

  it("does not cap pictures or long-form uploads, only their age", () => {
    const items = ["a", "b", "c"].map((id) => post(id, iso(-2), { instagram: leg() }, { mediaKind: "image" }));
    const plan = planRelease(items, items.map((item) => target(item.id)), options({ dailyCap: () => 1 }));
    expect(plan.moves).toEqual([]);
    const old = post("z", iso(-48), { instagram: leg() }, { mediaKind: "image" });
    expect(planRelease([old], [target("z")], options()).moves).toHaveLength(1);
  });

  it("skips a slot another post already holds on the same platform", () => {
    const [first, second] = futureSlots(1);
    const items = [post("held", first, { instagram: leg({ approvedAt: iso(-50) }) }), post("a", iso(-30), { instagram: leg() })];
    const plan = planRelease(items, [target("a")], options());
    expect(plan.moves[0].publishAt).toBe(second);
  });

  it("may use a slot that only another platform holds", () => {
    const [first] = futureSlots(1);
    const items = [post("tt", first, { tiktok: leg() }), post("a", iso(-30), { instagram: leg() })];
    expect(planRelease(items, [target("a")], options()).moves[0].publishAt).toBe(first);
  });

  it("leaves a leg held when there is no slot left to give it", () => {
    const items = [post("a", iso(-30), { instagram: leg() })];
    const plan = planRelease(items, [target("a")], options({ slots: [] }));
    expect(plan.release).toEqual([]);
    expect(plan.skipped).toEqual([target("a")]);
  });

  it("ignores a target that is gone, already sent or already approved", () => {
    const items = [
      post("sent", iso(-1), { instagram: leg({ status: "published", postId: "1", attempts: 1 }) }),
      post("done", iso(-1), { instagram: leg({ approvedAt: iso(-5) }) })
    ];
    const plan = planRelease(items, [target("sent"), target("done"), target("missing")], options());
    expect(plan.release).toEqual([]);
    expect(plan.moves).toEqual([]);
  });

  it("deals the oldest first", () => {
    const items = [post("late", iso(-1), { instagram: leg() }), post("early", iso(-10), { instagram: leg() }), post("mid", iso(-5), { instagram: leg() })];
    const plan = planRelease(items, items.map((item) => target(item.id)), options({ dailyCap: () => 1 }));
    expect(plan.moves.map((move) => move.id)).toEqual(["mid", "late"]);
  });
});
