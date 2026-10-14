import { describe, expect, it } from "vitest";
import { NoRoomForVariantsError, planVariantTimes } from "@/lib/experiments/plan";
import { VARIANT_GAP_MS } from "@/lib/experiments/spacing";
import { generateSlots } from "@/lib/publisher/slots";

const TIME_ZONE = "America/Toronto";
const NOW = new Date("2026-10-13T16:00:00.000Z");
const legs = [{ platform: "youtube" as const, accountId: "youtube-primary" }];

function slots(now = NOW, days = 30) {
  return generateSlots({ timeZone: TIME_ZONE, days, now, times: ["07:30", "12:30", "18:00"], weekendTimes: ["10:00", "16:00"] });
}

const nothingTaken = () => false;

describe("planVariantTimes", () => {
  it("starts on tomorrow's first slot and puts each later variant at least 48 hours after the one before", () => {
    const planned = planVariantTimes({ count: 3, slots: slots(), legs, taken: nothingTaken });
    expect(planned).toHaveLength(3);
    expect(planned[0]).toBe(slots().find((slot) => slot.bookable)!.utc);
    for (let index = 1; index < planned.length; index += 1) {
      expect(Date.parse(planned[index]) - Date.parse(planned[index - 1])).toBeGreaterThanOrEqual(VARIANT_GAP_MS);
    }
  });

  it("never plans a slot that is today", () => {
    const planned = planVariantTimes({ count: 2, slots: slots(), legs, taken: nothingTaken });
    const today = slots().filter((slot) => slot.today).map((slot) => slot.utc);
    expect(planned.some((utc) => today.includes(utc))).toBe(false);
  });

  it("skips a slot that is already taken on any of the platforms", () => {
    const first = slots().find((slot) => slot.bookable)!;
    const planned = planVariantTimes({
      count: 2,
      slots: slots(),
      legs: [...legs, { platform: "instagram", accountId: "instagram-primary" }],
      taken: (leg, utc) => leg.platform === "instagram" && utc === first.utc
    });
    expect(planned[0]).not.toBe(first.utc);
  });

  it("treats a slot taken on another account of the same platform as free", () => {
    const first = slots().find((slot) => slot.bookable)!;
    const planned = planVariantTimes({
      count: 2,
      slots: slots(),
      legs,
      taken: (leg, utc) => leg.accountId === "youtube-second" && utc === first.utc
    });
    expect(planned[0]).toBe(first.utc);
  });

  it("skips slots the caller rules out, such as a day already at the shorts limit", () => {
    const first = slots().find((slot) => slot.bookable)!;
    const planned = planVariantTimes({ count: 2, slots: slots(), legs, taken: nothingTaken, usable: (utc) => utc !== first.utc });
    expect(planned[0]).not.toBe(first.utc);
  });

  it("does not accept 47 hours when the clocks change between two slots at the same local time", () => {
    const beforeSpringForward = new Date("2026-03-05T17:00:00.000Z");
    const grid = generateSlots({ timeZone: TIME_ZONE, days: 14, now: beforeSpringForward, times: ["07:30", "10:00"], weekendTimes: ["07:30", "10:00"] });
    const planned = planVariantTimes({ count: 2, slots: grid, legs, taken: nothingTaken });
    expect(Date.parse(planned[1]) - Date.parse(planned[0])).toBeGreaterThanOrEqual(VARIANT_GAP_MS);
    const sameClock = grid.find((slot) => slot.dateKey === "2026-03-08" && slot.time === "07:30")!;
    expect(Date.parse(sameClock.utc) - Date.parse(planned[0])).toBeLessThan(VARIANT_GAP_MS);
    expect(planned[1]).not.toBe(sameClock.utc);
  });

  it("says so when there is no room for every variant", () => {
    expect(() => planVariantTimes({ count: 3, slots: slots(NOW, 4), legs, taken: nothingTaken })).toThrow(NoRoomForVariantsError);
    expect(() => planVariantTimes({ count: 3, slots: slots(NOW, 4), legs, taken: nothingTaken })).toThrow(/3 variants.*48 hours/);
  });
});
