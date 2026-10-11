import { describe, expect, it } from "vitest";
import {
  bookingMessage,
  bookingTimeLabel,
  activePlatformPicks,
  platformsClosedByBooking,
  scheduleFooterMode,
  DEFAULT_CAROUSEL_PLATFORMS,
  expandOccurrences,
  IMAGE_CAPABLE_PLATFORMS,
  planCarouselSchedule,
  platformPostingMode,
  anyPlatformPostsItself,
  bookingNeedsHands
} from "@/lib/carousels/schedule";
import type { Carousel } from "@/types/domain";

describe("which carousel networks really post", () => {
  it("lists only Instagram and Facebook, because the publisher refuses TikTok and YouTube pictures", () => {
    expect(IMAGE_CAPABLE_PLATFORMS).toEqual(["instagram", "facebook"]);
    expect(DEFAULT_CAROUSEL_PLATFORMS).toEqual(["instagram", "facebook"]);
    expect(platformPostingMode("instagram")).toBe("automatic");
    expect(platformPostingMode("tiktok")).toBe("manual");
    expect(platformPostingMode("youtube")).toBe("manual");
  });
});

describe("planCarouselSchedule", () => {
  it("books a one-off to Instagram and Facebook", () => {
    expect(planCarouselSchedule(["instagram", "facebook"], "once")).toEqual({
      book: ["instagram", "facebook"],
      remind: []
    });
  });

  it("splits a one-off that also names TikTok and YouTube into a booking and a reminder", () => {
    expect(planCarouselSchedule(["instagram", "tiktok", "youtube"], "once")).toEqual({
      book: ["instagram"],
      remind: ["tiktok", "youtube"]
    });
  });

  it("never books a repeating schedule: it is a reminder on every network", () => {
    expect(planCarouselSchedule(["instagram", "facebook"], "daily")).toEqual({
      book: [],
      remind: ["instagram", "facebook"]
    });
    expect(planCarouselSchedule(["instagram"], "weekly").book).toEqual([]);
  });

  it("ignores a repeated platform", () => {
    expect(planCarouselSchedule(["instagram", "instagram"], "once").book).toEqual(["instagram"]);
  });
});

describe("bookingMessage", () => {
  // 2026-10-13 19:00Z is Tuesday 3:00 PM in Toronto (EDT).
  const at = "2026-10-13T19:00:00.000Z";

  it("reads the day and time in the publish timezone", () => {
    expect(bookingTimeLabel(at, "America/Toronto", "America/Toronto")).toBe("Tue 3:00 PM");
  });

  it("names the publish zone when the browser is in another", () => {
    expect(bookingTimeLabel(at, "America/Toronto", "UTC")).toBe("Tue 3:00 PM EDT");
    expect(bookingMessage({ instagram: "pending" }, at, "America/Toronto", "Europe/London")).toBe(
      "Booked on Instagram for Tue 3:00 PM EDT"
    );
  });

  it("confirms a booking on both networks", () => {
    expect(bookingMessage({ instagram: "pending", facebook: "pending" }, at, "America/Toronto", "America/Toronto")).toBe(
      "Booked on Instagram and Facebook for Tue 3:00 PM"
    );
  });

  it("does not say booked for a network that is not connected", () => {
    expect(bookingMessage({ instagram: "pending", facebook: "manual" }, at, "America/Toronto", "America/Toronto")).toBe(
      "Booked on Instagram for Tue 3:00 PM. Facebook isn't connected - post those by hand."
    );
    expect(bookingMessage({ instagram: "manual", facebook: "manual" }, at, "America/Toronto", "America/Toronto")).toContain(
      "Instagram and Facebook aren't connected"
    );
  });
});

describe("expandOccurrences", () => {
  it("still expands a schedule saved before reminders were renamed", () => {
    const carousel = {
      id: "c1",
      title: "Deck",
      sourceType: "script",
      slides: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      schedules: [
        { id: "s1", platforms: ["tiktok"], time: "12:00", recurrence: "once", date: "2026-10-12", createdAt: "x" }
      ]
    } as Carousel;
    const found = expandOccurrences([carousel], new Date(2026, 9, 10), 28);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ dateKey: "2026-10-12", platforms: ["tiktok"] });
  });
});

describe("connection-aware posting mode", () => {
  it("calls an unconnected Instagram/Facebook a reminder, not automatic", () => {
    expect(platformPostingMode("instagram", { instagram: false })).toBe("reminder");
    expect(platformPostingMode("instagram", { instagram: true })).toBe("automatic");
    // Unknown (still loading) is never read as disconnected.
    expect(platformPostingMode("facebook", {})).toBe("automatic");
    expect(platformPostingMode("tiktok", { tiktok: true })).toBe("manual");
  });

  it("only promises posting when a selected network is really connected", () => {
    expect(anyPlatformPostsItself(["instagram", "facebook"], { instagram: false, facebook: false })).toBe(false);
    expect(anyPlatformPostsItself(["instagram", "facebook"], { instagram: false, facebook: true })).toBe(true);
  });

  it("reads manual legs from the route's statuses", () => {
    expect(bookingNeedsHands({ instagram: "manual", facebook: "manual" })).toBe(true);
    expect(bookingNeedsHands({ instagram: "pending", facebook: "manual" })).toBe(true);
    expect(bookingNeedsHands({ instagram: "pending", facebook: "pending" })).toBe(false);
  });
});

describe("a deck that is already booked", () => {
  it("closes both picture networks and leaves the reminder ones", () => {
    expect(platformsClosedByBooking(true)).toEqual(["instagram", "facebook"]);
    expect(platformsClosedByBooking(false)).toEqual([]);
    expect(activePlatformPicks(["instagram", "facebook", "tiktok"], true)).toEqual(["tiktok"]);
    expect(activePlatformPicks(["instagram", "facebook"], false)).toEqual(["instagram", "facebook"]);
  });

  it("offers Save only once a reminder network is picked", () => {
    expect(scheduleFooterMode(true, ["instagram", "facebook"])).toBe("close-only");
    expect(scheduleFooterMode(true, ["instagram", "facebook", "youtube"])).toBe("save");
    expect(scheduleFooterMode(false, [])).toBe("save");
  });
});
