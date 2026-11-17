import { describe, expect, it } from "vitest";
import { bookingSummary, durationLabel, fillTheWeek, runwayLine } from "@/lib/pipeline/shortsReviewDisplay";

describe("fillTheWeek", () => {
  it("fills the emptiest platform's week, counting approval holds as filled, capped at what is waiting", () => {
    const runway = [
      { platform: "youtube" as const, booked: 1, held: 0, expected: 21 },
      { platform: "instagram" as const, booked: 3, held: 4, expected: 21 }
    ];
    expect(fillTheWeek(runway, 100)).toBe(20);
    expect(fillTheWeek(runway, 7)).toBe(7);
    expect(fillTheWeek([{ platform: "youtube", booked: 25, held: 0, expected: 21 }], 10)).toBe(0);
    expect(fillTheWeek([], 10)).toBe(0);
  });
});

describe("page wording", () => {
  it("names approval holds beside the booked count", () => {
    expect(runwayLine({ platform: "youtube", booked: 2, held: 3, expected: 21 })).toBe("YouTube 2 of 21 (+3 waiting for your approval)");
    expect(runwayLine({ platform: "tiktok", booked: 0, held: 0, expected: 14 })).toBe("TikTok 0 of 14");
  });

  it("prints a clip length as minutes and seconds", () => {
    expect(durationLabel(42.6)).toBe("0:43");
    expect(durationLabel(75)).toBe("1:15");
  });

  it("summarises a booking honestly, including repeats and failures", () => {
    expect(bookingSummary({ booked: [{ title: "a", publishAt: "x" }], failed: [], stale: [] })).toEqual({ tone: "success", text: "1 Short booked." });
    expect(bookingSummary({ booked: [], failed: [], stale: ["a", "b"] })).toEqual({ tone: "warning", text: "2 were already booked or no longer waiting." });
    expect(bookingSummary({ booked: [{ title: "a", publishAt: "x" }], failed: [{ title: "b", error: "full" }], stale: [] })).toEqual({ tone: "warning", text: "1 Short booked, 1 could not be booked." });
    expect(bookingSummary({ booked: [], failed: [{ title: "b", error: "full" }], stale: [] }).tone).toBe("error");
    expect(bookingSummary({ booked: [], failed: [], stale: [] }).text).toBe("Nothing was booked.");
  });
});
