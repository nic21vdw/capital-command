import { describe, expect, it } from "vitest";
import { formatClockTime, formatSlotDateTime, formatSlotTime } from "@/lib/timeFormat";

describe("the app's one clock", () => {
  // 2026-10-14 22:00 UTC is 6:00 PM in Toronto (EDT) and 3:00 PM in Los Angeles (PDT).
  const instant = "2026-10-14T22:00:00.000Z";

  it("writes the wall clock of the given zone, 12-hour", () => {
    expect(formatSlotTime(instant, "America/Toronto")).toBe("6:00 PM");
    expect(formatSlotTime(instant, "America/Los_Angeles")).toBe("3:00 PM");
    expect(formatSlotTime("2026-10-14T16:30:00.000Z", "America/Toronto")).toBe("12:30 PM");
    expect(formatSlotTime("2026-10-14T04:05:00.000Z", "America/Toronto")).toBe("12:05 AM");
  });

  it("accepts a Date or a number and uses plain spaces", () => {
    expect(formatSlotTime(new Date(instant), "America/Toronto")).toBe("6:00 PM");
    expect(formatSlotTime(Date.parse(instant), "America/Toronto")).toBe("6:00 PM");
    expect(formatSlotTime(instant, "America/Toronto")).not.toMatch(/[  ]/);
  });

  it("follows daylight saving, not a fixed offset", () => {
    expect(formatSlotTime("2026-12-14T23:00:00.000Z", "America/Toronto")).toBe("6:00 PM");
  });

  it("writes the date with the time, with an optional weekday", () => {
    expect(formatSlotDateTime(instant, "America/Toronto")).toBe("Oct 14, 6:00 PM");
    expect(formatSlotDateTime(instant, "America/Toronto", { weekday: true })).toBe("Wed, Oct 14, 6:00 PM");
    // The zone decides the day too: 3:00 AM UTC is still the evening before in Toronto.
    expect(formatSlotDateTime("2026-10-15T03:00:00.000Z", "America/Toronto")).toBe("Oct 14, 11:00 PM");
  });

  it("returns an empty string for an unreadable date and survives an unknown zone", () => {
    expect(formatSlotTime("not a date", "America/Toronto")).toBe("");
    expect(formatSlotDateTime("", "America/Toronto")).toBe("");
    expect(formatSlotTime(instant, "Mars/Olympus")).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
  });

  it("turns an HH:mm wall clock into the same words without touching a zone", () => {
    expect(formatClockTime("18:00")).toBe("6:00 PM");
    expect(formatClockTime("07:30")).toBe("7:30 AM");
    expect(formatClockTime("00:15")).toBe("12:15 AM");
    expect(formatClockTime("12:00")).toBe("12:00 PM");
    expect(formatClockTime("23:59")).toBe("11:59 PM");
  });

  it("leaves anything that is not HH:mm as it was", () => {
    expect(formatClockTime("6pm")).toBe("6pm");
    expect(formatClockTime("25:00")).toBe("25:00");
    expect(formatClockTime("")).toBe("");
  });

  it("agrees with itself: an instant and its HH:mm read the same", () => {
    expect(formatClockTime("18:00")).toBe(formatSlotTime(instant, "America/Toronto"));
  });
});
