import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertShortsRoom,
  firstSlotWithShortsRoom,
  movesBreachShortsCap,
  shortsByDay,
  shortsLimit,
  ShortsCapError
} from "@/lib/publisher/shortsCap";
import { testItem } from "@/lib/publisher/test-helpers";

const TZ = "America/Toronto";

describe("counting shorts per day", () => {
  it("counts only short-form video, by local calendar day", () => {
    const counts = shortsByDay(
      [
        { publishAt: "2026-10-05T16:00:00.000Z" },
        { publishAt: "2026-10-06T02:30:00.000Z" },
        { publishAt: "2026-10-05T17:00:00.000Z", format: "long" },
        { publishAt: "2026-10-05T18:00:00.000Z", mediaKind: "image" }
      ],
      TZ
    );
    expect(counts.get("2026-10-05")).toBe(2);
    expect(counts.get("2026-10-06")).toBeUndefined();
  });

  it("defaults the limit to two and honours a configured one", () => {
    expect(shortsLimit({})).toBe(2);
    expect(shortsLimit({ shortsPerDay: 3 })).toBe(3);
    expect(shortsLimit({ shortsPerDay: 0 })).toBe(2);
  });

  it("refuses a third short on a day and allows it on the next", () => {
    const booked = [{ publishAt: "2026-10-05T12:00:00.000Z" }, { publishAt: "2026-10-05T20:00:00.000Z" }];
    expect(() => assertShortsRoom(booked, "2026-10-05T22:00:00.000Z", TZ, 2)).toThrow(ShortsCapError);
    expect(() => assertShortsRoom(booked, "2026-10-06T14:00:00.000Z", TZ, 2)).not.toThrow();
  });

  it("finds the first slot on a day with room", () => {
    const booked = [{ publishAt: "2026-10-05T12:00:00.000Z" }, { publishAt: "2026-10-05T20:00:00.000Z" }];
    const slots = ["2026-10-05T22:00:00.000Z", "2026-10-06T14:00:00.000Z"];
    expect(firstSlotWithShortsRoom(slots, booked, TZ, 2)).toBe("2026-10-06T14:00:00.000Z");
  });

  it("flags schedule moves that would push a day past the limit", () => {
    const items = [
      testItem({ id: "a", clipPath: "clips/a.mp4", publishAt: "2026-10-05T12:00:00.000Z" }),
      testItem({ id: "b", clipPath: "clips/b.mp4", publishAt: "2026-10-05T20:00:00.000Z" }),
      testItem({ id: "c", clipPath: "clips/c.mp4", publishAt: "2026-10-06T14:00:00.000Z" })
    ];
    expect(movesBreachShortsCap(items, [{ id: "c", to: "2026-10-05T22:00:00.000Z" }], TZ, 2)).toBe(true);
    expect(movesBreachShortsCap(items, [{ id: "a", to: "2026-10-06T20:00:00.000Z" }], TZ, 2)).toBe(false);
  });
});

describe("the limit counts videos, not queue posts", () => {
  const day1 = "2026-10-05T14:00:00.000Z";
  const post = (id: string, clipPath: string, publishAt = day1) => testItem({ id, clipPath, publishAt });
  const allPlatformsOfA = [post("a-yt", "clips/a.mp4"), post("a-tt", "clips/a.mp4"), post("a-ig", "clips/a.mp4")];

  it("counts three posts of one clip on a day as one short", () => {
    expect(shortsByDay(allPlatformsOfA, TZ).get("2026-10-05")).toBe(1);
  });

  it("counts a landscape master and its vertical render as one video", () => {
    const items = [
      testItem({ id: "x1", clipPath: "clips/a-vertical.mp4", sourceClipPath: "clips/a.mp4", publishAt: day1 }),
      testItem({ id: "x2", clipPath: "clips/a-vertical.mp4", sourceClipPath: "clips/a.mp4", publishAt: day1 })
    ];
    expect(shortsByDay(items, TZ).get("2026-10-05")).toBe(1);
    expect(() => assertShortsRoom(items, day1, TZ, 1, "clips/a.mp4")).not.toThrow();
  });

  it("falls back to the item id when there is no clip path", () => {
    const items = [
      { id: "p", publishAt: day1 },
      { id: "p", publishAt: day1 },
      { id: "q", publishAt: day1 }
    ];
    expect(shortsByDay(items, TZ).get("2026-10-05")).toBe(2);
  });

  it("allows the 2nd and 3rd platform of an already-booked clip on a full day", () => {
    const full = [...allPlatformsOfA.slice(0, 1), post("b-yt", "clips/b.mp4")];
    expect(() => assertShortsRoom(full, day1, TZ, 2, "clips/a.mp4")).not.toThrow();
    expect(() => assertShortsRoom(full, day1, TZ, 2, "clips/b.mp4")).not.toThrow();
    const fullWithAllPlatforms = [...allPlatformsOfA, post("b-yt", "clips/b.mp4"), post("b-tt", "clips/b.mp4")];
    expect(() => assertShortsRoom(fullWithAllPlatforms, day1, TZ, 2, "clips/a.mp4")).not.toThrow();
  });

  it("still refuses a different third clip on that day", () => {
    const full = [...allPlatformsOfA, post("b-yt", "clips/b.mp4"), post("b-tt", "clips/b.mp4")];
    expect(() => assertShortsRoom(full, day1, TZ, 2, "clips/c.mp4")).toThrow(ShortsCapError);
    expect(() => assertShortsRoom(full, day1, TZ, 2)).toThrow(ShortsCapError);
  });

  it("does not let a clip booked on another day claim room on a full one", () => {
    const full = [post("a1", "clips/a.mp4"), post("b1", "clips/b.mp4"), post("c1", "clips/c.mp4", "2026-10-06T14:00:00.000Z")];
    expect(() => assertShortsRoom(full, day1, TZ, 2, "clips/c.mp4")).toThrow(ShortsCapError);
  });

  it("picks a slot on a full day for a clip already on it", () => {
    const full = [post("a1", "clips/a.mp4"), post("b1", "clips/b.mp4")];
    const slots = ["2026-10-05T22:00:00.000Z", "2026-10-06T14:00:00.000Z"];
    expect(firstSlotWithShortsRoom(slots, full, TZ, 2, "clips/a.mp4")).toBe("2026-10-05T22:00:00.000Z");
    expect(firstSlotWithShortsRoom(slots, full, TZ, 2, "clips/c.mp4")).toBe("2026-10-06T14:00:00.000Z");
  });

  it("judges moves in videos: shifting one platform of a clip", () => {
    const items = [...allPlatformsOfA, post("b-yt", "clips/b.mp4"), post("c-yt", "clips/c.mp4", "2026-10-06T14:00:00.000Z")];
    // Moving one of a's three posts off a day that keeps a and b frees nothing but breaches nothing.
    expect(movesBreachShortsCap(items, [{ id: "a-tt", to: "2026-10-06T20:00:00.000Z" }], TZ, 2)).toBe(false);
    // Moving all of a's posts together onto the day with c is fine; so is a day that fits both.
    const together = allPlatformsOfA.map((item) => ({ id: item.id, to: "2026-10-06T20:00:00.000Z" }));
    expect(movesBreachShortsCap(items, together, TZ, 2)).toBe(false);
    // A third video on a full day is a breach, however many posts of the first two it holds.
    expect(movesBreachShortsCap(items, [{ id: "c-yt", to: day1 }], TZ, 2)).toBe(true);
  });
});

describe("enqueue holds the line", () => {
  let dir: string;
  let clip: string;

  function dateKeyIn(days: number): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(Date.now() + days * 86_400_000)
    );
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "shorts-cap-"));
    clip = path.join(dir, "clip.mp4");
    await writeFile(clip, Buffer.alloc(64, 1));
    vi.stubEnv("PUBLISH_ENABLED", "true");
    vi.stubEnv("PUBLISH_PLATFORMS", "youtube");
    vi.stubEnv("PUBLISH_TIMEZONE", TZ);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seed(format?: "long", firstClipPath?: string) {
    const { publishQueue } = await import("@/lib/publisher/queue");
    const day = dateKeyIn(3);
    for (const [index, time] of ["10:00", "15:00"].entries()) {
      await publishQueue().add(
        testItem({
          id: `seed${index}`,
          clipPath: index === 0 && firstClipPath ? firstClipPath : path.join(dir, `seed${index}.mp4`),
          publishAt: new Date(`${day}T${time}:00-04:00`).toISOString(),
          ...(format ? { format } : {})
        })
      );
    }
    return day;
  }

  it("refuses a third short on a day that already has two", async () => {
    const day = await seed();
    const { enqueue } = await import("@/lib/publisher/enqueue");
    const { ShortsCapError: Fresh } = await import("@/lib/publisher/shortsCap");
    await expect(
      enqueue({ clipPath: clip, publishAt: `${day}T20:00`, title: "t", caption: "c", hashtags: ["#a"] })
    ).rejects.toBeInstanceOf(Fresh);
  });

  it("lets another platform of an already-booked clip onto a full day", async () => {
    const day = await seed(undefined, path.relative(process.cwd(), clip));
    const { enqueue } = await import("@/lib/publisher/enqueue");
    const { ShortsCapError: Fresh } = await import("@/lib/publisher/shortsCap");
    const outcome = await enqueue({
      clipPath: clip,
      publishAt: `${day}T10:00`,
      title: "t",
      caption: "c",
      hashtags: ["#a"],
      platforms: ["tiktok"],
      allowDuplicate: true
    }).catch((error: unknown) => error);
    expect(outcome).not.toBeInstanceOf(Fresh);
  });

  it("lets a short through when the day's other posts are long-form", async () => {
    const day = await seed("long");
    const { enqueue } = await import("@/lib/publisher/enqueue");
    const { ShortsCapError: Fresh } = await import("@/lib/publisher/shortsCap");
    const outcome = await enqueue({ clipPath: clip, publishAt: `${day}T20:00`, title: "t", caption: "c", hashtags: ["#a"] }).catch(
      (error: unknown) => error
    );
    expect(outcome).not.toBeInstanceOf(Fresh);
  });
});
