import { describe, expect, it } from "vitest";
import { dateKeyOffset, summarizeDay } from "@/lib/publisher/daySummary";
import type { PlatformState, QueueItem } from "@/lib/publisher/types";

function item(
  publishAt: string,
  platforms: QueueItem["platforms"],
  extra: Partial<QueueItem> = {}
): QueueItem {
  return {
    id: extra.id ?? `q-${publishAt}`,
    clipPath: "clip.mp4",
    title: extra.title ?? "A clip",
    caption: "",
    hashtags: [],
    publishAt,
    visibility: "public",
    createdAt: "2026-08-01T00:00:00.000Z",
    platforms,
    ...extra
  };
}

const failed = (error: string): PlatformState => ({ status: "failed", attempts: 1, error });
const pending: PlatformState = { status: "pending", attempts: 0 };

describe("dateKeyOffset", () => {
  it("crosses midnight in the target zone, not UTC", () => {
    // 01:30 UTC on the 19th is still the 18th in Toronto (UTC-4).
    const now = new Date("2026-08-19T01:30:00.000Z");
    expect(dateKeyOffset(now, "America/Toronto", 0)).toBe("2026-08-18");
    expect(dateKeyOffset(now, "America/Toronto", 1)).toBe("2026-08-19");
    expect(dateKeyOffset(now, "UTC", 1)).toBe("2026-08-20");
  });

  it("rolls over a month end", () => {
    expect(dateKeyOffset(new Date("2026-08-31T12:00:00.000Z"), "UTC", 1)).toBe("2026-09-01");
  });
});

describe("summarizeDay", () => {
  it("keeps only the requested local day and orders it by wall-clock time", () => {
    const summary = summarizeDay(
      [
        item("2026-08-19T23:30:00.000Z", { youtube: pending }, { id: "late" }),
        item("2026-08-19T16:30:00.000Z", { youtube: pending }, { id: "noon" }),
        item("2026-08-20T11:30:00.000Z", { youtube: pending }, { id: "next-day" })
      ],
      { dateKey: "2026-08-19", timeZone: "America/Toronto" }
    );

    expect(summary.posts.map((post) => post.id)).toEqual(["noon", "late"]);
    expect(summary.posts.map((post) => post.time)).toEqual(["12:30", "19:30"]);
    expect(summary.dateLabel).toBe("Wed, Aug 19");
  });

  it("rolls a platform up across the day and dedupes its failure reasons", () => {
    const dead = "YouTube connection expired or was revoked.";
    const summary = summarizeDay(
      [
        item("2026-08-19T11:30:00.000Z", { youtube: failed(dead), instagram: pending }),
        item("2026-08-19T16:30:00.000Z", { youtube: failed(dead), instagram: pending }),
        item("2026-08-19T21:30:00.000Z", {
          youtube: { status: "published", attempts: 1 },
          instagram: pending
        })
      ],
      { dateKey: "2026-08-19", timeZone: "America/Toronto" }
    );

    const youtube = summary.platforms.find((p) => p.platform === "youtube");
    expect(youtube).toMatchObject({ total: 3, failed: 2, published: 1, inFlight: 0 });
    expect(youtube?.reasons).toEqual([dead]);

    const instagram = summary.platforms.find((p) => p.platform === "instagram");
    expect(instagram).toMatchObject({ total: 3, inFlight: 3, failed: 0 });
    expect(instagram?.reasons).toEqual([]);

    expect(summary.totals.failedLegs).toBe(2);
  });

  it("omits platforms nothing targets that day", () => {
    const summary = summarizeDay([item("2026-08-19T11:30:00.000Z", { tiktok: pending })], {
      dateKey: "2026-08-19",
      timeZone: "America/Toronto"
    });
    expect(summary.platforms.map((p) => p.platform)).toEqual(["tiktok"]);
  });

  it("separates image decks from video and counts their slides", () => {
    const summary = summarizeDay(
      [
        item("2026-08-19T11:30:00.000Z", { instagram: pending }, { id: "vid" }),
        item(
          "2026-08-19T16:30:00.000Z",
          { instagram: pending },
          { id: "deck", mediaKind: "image", imagePaths: ["a.jpg", "b.jpg", "c.jpg"] }
        )
      ],
      { dateKey: "2026-08-19", timeZone: "America/Toronto" }
    );

    expect(summary.totals).toMatchObject({ posts: 2, videos: 1, images: 1 });
    expect(summary.posts.find((p) => p.id === "deck")?.slideCount).toBe(3);
    expect(summary.posts.find((p) => p.id === "vid")?.slideCount).toBe(0);
  });

  it("returns an empty day rather than throwing when nothing is booked", () => {
    const summary = summarizeDay([], { dateKey: "2026-08-19", timeZone: "America/Toronto" });
    expect(summary.posts).toEqual([]);
    expect(summary.platforms).toEqual([]);
    expect(summary.totals.posts).toBe(0);
  });
});
