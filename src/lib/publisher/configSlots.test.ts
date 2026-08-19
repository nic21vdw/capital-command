import { afterEach, describe, expect, it, vi } from "vitest";
import { publisherConfig } from "@/lib/publisher/config";
import {
  DEFAULT_BOOKING_HORIZON_DAYS,
  DEFAULT_SLOT_TIMES,
  DEFAULT_WEEKEND_SLOT_TIMES
} from "@/lib/publisher/slots";

/**
 * How much can be posted in a day is configuration, not a constant. It used to
 * be three hardcoded times against a 120-day ceiling, which is what made a
 * queue with room in it report that every slot was taken.
 */
describe("the posting grid", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to six a day for a year", () => {
    const config = publisherConfig();
    expect(config.slotTimes).toEqual(DEFAULT_SLOT_TIMES);
    expect(config.slotTimes).toHaveLength(6);
    expect(config.weekendSlotTimes).toEqual(DEFAULT_WEEKEND_SLOT_TIMES);
    expect(config.bookingHorizonDays).toBe(DEFAULT_BOOKING_HORIZON_DAYS);
  });

  it("reads times from the environment, sorted and de-duplicated", () => {
    vi.stubEnv("PUBLISH_SLOT_TIMES", "21:00, 06:00,09:15 ,06:00");
    expect(publisherConfig().slotTimes).toEqual(["06:00", "09:15", "21:00"]);
  });

  // A typo must not silently shrink the day to one slot — that would quietly
  // stop most of a day's posts without anything reporting a problem.
  it("falls back whole when every entry is junk", () => {
    vi.stubEnv("PUBLISH_SLOT_TIMES", "lunchtime, 25:00, 7.30");
    expect(publisherConfig().slotTimes).toEqual(DEFAULT_SLOT_TIMES);
  });

  it("keeps the valid times when only some are junk", () => {
    vi.stubEnv("PUBLISH_WEEKEND_SLOT_TIMES", "11:00, nope, 16:45");
    expect(publisherConfig().weekendSlotTimes).toEqual(["11:00", "16:45"]);
  });

  it("takes the horizon from the environment", () => {
    vi.stubEnv("PUBLISH_BOOKING_HORIZON_DAYS", "540");
    expect(publisherConfig().bookingHorizonDays).toBe(540);
  });
});
