import { describe, expect, it } from "vitest";
import { bookedClip, listPlatforms } from "@/components/uploading-center/booked-clip";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

const when = (iso: string) => `at ${iso.slice(0, 16)}`;

function item(id: string, publishAt: string, legs: Partial<Record<PlatformId, PlatformState["status"]>>): QueueItem {
  return {
    id,
    title: `Title ${id}`,
    publishAt,
    platforms: Object.fromEntries(Object.entries(legs).map(([platform, status]) => [platform, { status }]))
  } as unknown as QueueItem;
}

describe("listPlatforms", () => {
  it("reads as a sentence", () => {
    expect(listPlatforms(["youtube"])).toBe("YouTube");
    expect(listPlatforms(["youtube", "tiktok"])).toBe("YouTube and TikTok");
    expect(listPlatforms(["youtube", "tiktok", "instagram"])).toBe("YouTube, TikTok and Instagram");
  });
});

describe("bookedClip", () => {
  it("is null for a clip with nothing booked, so it keeps its full card", () => {
    expect(bookedClip([], when)).toBeNull();
  });

  it("is null while every leg has failed: that is not done, and the card keeps its retry route", () => {
    expect(bookedClip([item("a", "2026-10-12T11:30:00Z", { youtube: "failed", tiktok: "failed" })], when)).toBeNull();
  });

  it("says when and where, in the app's platform order", () => {
    const booked = bookedClip(
      [item("a", "2026-10-12T11:30:00Z", { facebook: "pending", youtube: "scheduled", instagram: "pending" })],
      when
    );
    expect(booked?.label).toBe("Booked at 2026-10-12T11:30 on YouTube, Instagram and Facebook");
    expect(booked?.title).toBe("Title a");
    expect(booked?.platforms).toEqual(["youtube", "instagram", "facebook"]);
    expect(booked?.failedLegs).toBe(0);
  });

  it("leads with the earliest booking and counts the others", () => {
    const booked = bookedClip(
      [
        item("late", "2026-10-15T11:30:00Z", { tiktok: "pending" }),
        item("early", "2026-10-12T11:30:00Z", { youtube: "scheduled" }),
        item("mid", "2026-10-13T11:30:00Z", { youtube: "scheduled" })
      ],
      when
    );
    expect(booked?.item.id).toBe("early");
    expect(booked?.label).toBe("Booked at 2026-10-12T11:30 on YouTube and TikTok and 2 more bookings");
  });

  it("names a single extra booking in the singular", () => {
    const booked = bookedClip(
      [item("a", "2026-10-12T11:30:00Z", { youtube: "scheduled" }), item("b", "2026-10-13T11:30:00Z", { youtube: "scheduled" })],
      when
    );
    expect(booked?.label).toMatch(/and 1 more booking$/);
  });

  it("does not list a platform whose leg failed, but counts the failure", () => {
    const booked = bookedClip([item("a", "2026-10-12T11:30:00Z", { youtube: "scheduled", tiktok: "failed" })], when);
    expect(booked?.platforms).toEqual(["youtube"]);
    expect(booked?.label).toBe("Booked at 2026-10-12T11:30 on YouTube");
    expect(booked?.failedLegs).toBe(1);
  });

  it("ignores a fully failed sibling booking", () => {
    const booked = bookedClip(
      [item("a", "2026-10-12T11:30:00Z", { youtube: "failed" }), item("b", "2026-10-13T11:30:00Z", { youtube: "scheduled" })],
      when
    );
    expect(booked?.item.id).toBe("b");
    expect(booked?.label).toBe("Booked at 2026-10-13T11:30 on YouTube");
  });
});
