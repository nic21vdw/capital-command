import { describe, expect, it } from "vitest";
import {
  assertBookable,
  earliestPublishDateKey,
  isSameDayOrEarlier,
  TooSoonError
} from "@/lib/publisher/schedule";
import { generateSlots, nextBookableSlot } from "@/lib/publisher/slots";

const TZ = "America/Toronto";
// 2026-08-11 09:00 Toronto — a booking made in the morning, with the day's
// 12:30 and 19:30 slots still to come. Those are exactly what must not be taken.
const NOW = new Date("2026-08-11T13:00:00Z");

describe("the earliest a post may go out", () => {
  it("is tomorrow, in the publish timezone", () => {
    expect(earliestPublishDateKey(NOW, TZ)).toBe("2026-08-12");
  });

  it("reads the local calendar day, not UTC's", () => {
    // 2026-08-12T02:00Z is still the 11th in Toronto, so tomorrow is the 12th.
    expect(earliestPublishDateKey(new Date("2026-08-12T02:00:00Z"), TZ)).toBe("2026-08-12");
    expect(earliestPublishDateKey(new Date("2026-08-12T02:00:00Z"), "UTC")).toBe("2026-08-13");
  });

  it("refuses a slot later the same day", () => {
    // 19:30 Toronto on the day of booking.
    expect(isSameDayOrEarlier("2026-08-11T23:30:00Z", NOW, TZ)).toBe(true);
    expect(() => assertBookable("2026-08-11T23:30:00Z", NOW, TZ)).toThrow(TooSoonError);
  });

  it("accepts the first slot tomorrow", () => {
    // 07:30 Toronto on 2026-08-12.
    expect(isSameDayOrEarlier("2026-08-12T11:30:00Z", NOW, TZ)).toBe(false);
    expect(() => assertBookable("2026-08-12T11:30:00Z", NOW, TZ)).not.toThrow();
  });

  it("lets a person override it explicitly", () => {
    expect(() => assertBookable("2026-08-11T23:30:00Z", NOW, TZ, { allowSameDay: true })).not.toThrow();
  });

  it("says why, and what the earliest is", () => {
    expect(() => assertBookable("2026-08-11T23:30:00Z", NOW, TZ)).toThrow(/today/i);
    expect(() => assertBookable("2026-08-11T23:30:00Z", NOW, TZ)).toThrow(/2026-08-12/);
  });
});

describe("the slot grid", () => {
  it("marks today's remaining slots unbookable, and keeps showing them", () => {
    const slots = generateSlots({ timeZone: TZ, days: 3, now: NOW });
    const today = slots.filter((slot) => slot.dateKey === "2026-08-11");
    expect(today).toHaveLength(3);
    expect(today.map((slot) => slot.past)).toEqual([true, false, false]);
    // Not past, but still not bookable — that is the whole rule.
    expect(today.every((slot) => slot.bookable)).toBe(false);
    expect(slots.filter((slot) => slot.bookable).every((slot) => slot.dateKey > "2026-08-11")).toBe(true);
  });

  it("offers every slot from tomorrow on", () => {
    const slots = generateSlots({ timeZone: TZ, days: 3, now: NOW });
    expect(slots.filter((slot) => slot.dateKey === "2026-08-12").every((slot) => slot.bookable)).toBe(true);
  });

  it("gives an automatic booking tomorrow's first slot", () => {
    // 2026-08-12 is a Wednesday, so the weekday times apply: 07:30 first.
    const slot = nextBookableSlot({ timeZone: TZ, now: NOW });
    expect(slot.dateKey).toBe("2026-08-12");
    expect(slot.time).toBe("07:30");
    expect(isSameDayOrEarlier(slot.utc, NOW, TZ)).toBe(false);
  });
});
