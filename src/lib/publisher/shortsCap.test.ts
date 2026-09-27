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
      testItem({ id: "a", publishAt: "2026-10-05T12:00:00.000Z" }),
      testItem({ id: "b", publishAt: "2026-10-05T20:00:00.000Z" }),
      testItem({ id: "c", publishAt: "2026-10-06T14:00:00.000Z" })
    ];
    expect(movesBreachShortsCap(items, [{ id: "c", to: "2026-10-05T22:00:00.000Z" }], TZ, 2)).toBe(true);
    expect(movesBreachShortsCap(items, [{ id: "a", to: "2026-10-06T20:00:00.000Z" }], TZ, 2)).toBe(false);
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

  async function seed(format?: "long") {
    const { publishQueue } = await import("@/lib/publisher/queue");
    const day = dateKeyIn(3);
    for (const [index, time] of ["10:00", "15:00"].entries()) {
      await publishQueue().add(
        testItem({
          id: `seed${index}`,
          clipPath: path.join(dir, `seed${index}.mp4`),
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
