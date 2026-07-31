import { afterEach, describe, expect, it } from "vitest";
import { scheduleTimes } from "@/lib/x-posts/generator";

/**
 * A pack's slot times. The default is the whole clock, because that is what the
 * Threads autopilot posts against — a day of 24 lands roughly one an hour, all
 * day and all night, well under the 250-a-day the API allows.
 */

function minutesOf(time: string): number {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

afterEach(() => {
  delete process.env.THREADS_DAY_START;
  delete process.env.THREADS_DAY_END;
});

describe("scheduleTimes", () => {
  it("spreads a day of posts across the whole clock", () => {
    const times = scheduleTimes("2026-07-30", 24);
    const minutes = times.map(minutesOf);

    expect(times).toHaveLength(24);
    expect(minutes[0]).toBeLessThan(60);
    expect(minutes[23]).toBeGreaterThan(23 * 60);
    // Ascending, and never so tight that two posts land in the same few minutes.
    const gaps = minutes.slice(1).map((value, index) => value - minutes[index]);
    expect(Math.min(...gaps)).toBeGreaterThan(30);
  });

  it("is every valid clock time, jitter and all", () => {
    for (const time of scheduleTimes("2026-07-30", 24)) {
      expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });

  it("is stable for a given day and varies between days", () => {
    expect(scheduleTimes("2026-07-30", 24)).toEqual(scheduleTimes("2026-07-30", 24));
    expect(scheduleTimes("2026-07-30", 24)).not.toEqual(scheduleTimes("2026-07-31", 24));
  });

  it("pulls back to waking hours when a window is set", () => {
    process.env.THREADS_DAY_START = "08:00";
    process.env.THREADS_DAY_END = "20:00";

    const minutes = scheduleTimes("2026-07-30", 24).map(minutesOf);

    expect(Math.min(...minutes)).toBeGreaterThanOrEqual(8 * 60 - 10);
    expect(Math.max(...minutes)).toBeLessThanOrEqual(20 * 60 + 10);
  });

  it("reads a window that ends before it starts as the rest of the day", () => {
    process.env.THREADS_DAY_START = "22:00";
    process.env.THREADS_DAY_END = "06:00";

    const minutes = scheduleTimes("2026-07-30", 4).map(minutesOf);

    // Never wraps past midnight, which would put the later slots on the next
    // calendar day while still carrying today's batch date.
    expect(Math.min(...minutes)).toBeGreaterThanOrEqual(22 * 60 - 10);
    expect(Math.max(...minutes)).toBeLessThan(24 * 60);
  });
});
