import { describe, expect, it } from "vitest";
import { YOUTUBE_DAILY_UNITS, YOUTUBE_UNITS_PER_UPLOAD } from "@/lib/publisher/quota";
import { DEFAULT_SLOT_TIMES, DEFAULT_WEEKEND_SLOT_TIMES, generateSlots } from "@/lib/publisher/slots";

const TZ = "America/Toronto";

function slot(slots: ReturnType<typeof generateSlots>, id: string) {
  const found = slots.find((s) => s.id === id);
  if (!found) throw new Error(`No slot ${id} in [${slots.map((s) => s.id).join(", ")}]`);
  return found;
}

/** Minutes between consecutive times, which is what "evenly spaced" means here. */
function gaps(times: string[]): number[] {
  const minutes = times.map((time) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
  });
  return minutes.slice(1).map((minute, index) => minute - minutes[index]);
}

describe("generateSlots", () => {
  it("emits the configured slots every day: weekday times on weekdays, weekend times on weekends", () => {
    // Wed Mar 4 2026 → Mar 4-17 covers 10 weekdays and 4 weekend days.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z") });
    expect(slots).toHaveLength(14 * DEFAULT_SLOT_TIMES.length);
    const dates = new Set(slots.map((s) => s.dateKey));
    expect(dates.size).toBe(14);
    expect(slots.filter((s) => s.dateKey === "2026-03-06").map((s) => s.time)).toEqual(DEFAULT_SLOT_TIMES); // Friday
    expect(slots.filter((s) => s.dateKey === "2026-03-07").map((s) => s.time)).toEqual(DEFAULT_WEEKEND_SLOT_TIMES); // Saturday
    expect(slots.filter((s) => s.dateKey === "2026-03-08").map((s) => s.time)).toEqual(DEFAULT_WEEKEND_SLOT_TIMES); // Sunday
  });

  // The grid is configuration, not a constant: a caller that asks for its own
  // times gets exactly those, which is what lets the picker and the booking
  // sheet promise the same day.
  it("uses the times it is given, weekday and weekend alike", () => {
    const slots = generateSlots({
      timeZone: TZ,
      now: new Date("2026-03-04T15:00:00Z"),
      days: 4,
      times: ["09:00", "21:00"],
      weekendTimes: ["11:00"]
    });
    expect(slots.filter((s) => s.dateKey === "2026-03-06").map((s) => s.time)).toEqual(["09:00", "21:00"]); // Friday
    expect(slots.filter((s) => s.dateKey === "2026-03-07").map((s) => s.time)).toEqual(["11:00"]); // Saturday
  });

  it("spaces both grids evenly, so six a day reads as presence and not as a burst", () => {
    expect(new Set(gaps(DEFAULT_SLOT_TIMES))).toEqual(new Set([150]));
    expect(new Set(gaps(DEFAULT_WEEKEND_SLOT_TIMES))).toEqual(new Set([150]));
  });

  it("books no more uploads a day than YouTube's API quota allows", () => {
    // videos.insert costs 1600 of 10,000 units a day — six fit, a seventh would
    // be a slot the runner could never upload into. See quota.ts.
    const ceiling = Math.floor(YOUTUBE_DAILY_UNITS / YOUTUBE_UNITS_PER_UPLOAD);
    expect(DEFAULT_SLOT_TIMES.length).toBeLessThanOrEqual(ceiling);
    expect(DEFAULT_WEEKEND_SLOT_TIMES.length).toBeLessThanOrEqual(ceiling);
  });

  it("converts Toronto wall-clock to UTC across the spring-forward boundary", () => {
    // DST starts Sun Mar 8 2026 in America/Toronto (EST -5 → EDT -4).
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z") });
    expect(slot(slots, "2026-03-06 07:30").utc).toBe("2026-03-06T12:30:00.000Z"); // EST
    expect(slot(slots, "2026-03-09 07:30").utc).toBe("2026-03-09T11:30:00.000Z"); // EDT
  });

  it("converts across the fall-back boundary, including a UTC date rollover", () => {
    // DST ends Sun Nov 1 2026 (EDT -4 → EST -5).
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-10-28T15:00:00Z") });
    expect(slot(slots, "2026-10-30 20:00").utc).toBe("2026-10-31T00:00:00.000Z"); // EDT, next UTC day
    expect(slot(slots, "2026-11-02 20:00").utc).toBe("2026-11-03T01:00:00.000Z"); // EST, next UTC day
  });

  it("marks slots earlier than now as past", () => {
    // 15:00Z on Mar 4 is 10:00 in Toronto — the 07:30 slot is gone.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z") });
    expect(slot(slots, "2026-03-04 07:30").past).toBe(true);
    expect(slot(slots, "2026-03-04 12:30").past).toBe(false);
  });

  it("flags only the first day as today, including past slots on that day", () => {
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z") });
    expect(slots.filter((s) => s.today).map((s) => s.id)).toEqual(
      DEFAULT_SLOT_TIMES.map((time) => `2026-03-04 ${time}`)
    );
  });

  it("pages forward with startDayOffset: the window starts N days after today", () => {
    // Same Wed Mar 4 2026 anchor, next two-week period → Mar 18-31.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z"), startDayOffset: 14 });
    expect(slots).toHaveLength(14 * DEFAULT_SLOT_TIMES.length);
    expect(slots[0].dateKey).toBe("2026-03-18");
    expect(slots[slots.length - 1].dateKey).toBe("2026-03-31");
    // A future window contains neither today nor past slots.
    expect(slots.some((s) => s.today)).toBe(false);
    expect(slots.some((s) => s.past)).toBe(false);
    // Weekend detection still tracks the actual calendar day.
    expect(slots.filter((s) => s.dateKey === "2026-03-21").map((s) => s.time)).toEqual(DEFAULT_WEEKEND_SLOT_TIMES); // Saturday
  });

  it("keeps UTC conversion correct in offset windows that cross DST", () => {
    // Window Mar 4 + 4 = Mar 8-21; DST starts Sun Mar 8 2026 in Toronto.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z"), startDayOffset: 4 });
    expect(slot(slots, "2026-03-09 07:30").utc).toBe("2026-03-09T11:30:00.000Z"); // EDT
  });

  it("starts from the local calendar date, not the UTC one", () => {
    // 02:00Z on Mar 5 is still 21:00 Mar 4 in Toronto.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-05T02:00:00Z") });
    expect(slots[0].dateKey).toBe("2026-03-04");
    expect(slots[0].today).toBe(true);
  });
});
