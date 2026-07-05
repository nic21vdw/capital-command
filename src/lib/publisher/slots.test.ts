import { describe, expect, it } from "vitest";
import { generateSlots } from "@/lib/publisher/slots";

const TZ = "America/Toronto";

function slot(slots: ReturnType<typeof generateSlots>, id: string) {
  const found = slots.find((s) => s.id === id);
  if (!found) throw new Error(`No slot ${id} in [${slots.map((s) => s.id).join(", ")}]`);
  return found;
}

describe("generateSlots", () => {
  it("emits 3 slots every day: weekday times on weekdays, weekend times on weekends", () => {
    // Wed Mar 4 2026 → Mar 4-17 covers 10 weekdays and 4 weekend days.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z") });
    expect(slots).toHaveLength(42);
    const dates = new Set(slots.map((s) => s.dateKey));
    expect(dates.size).toBe(14);
    expect(slots.filter((s) => s.dateKey === "2026-03-06").map((s) => s.time)).toEqual(["07:30", "12:30", "19:30"]); // Friday
    expect(slots.filter((s) => s.dateKey === "2026-03-07").map((s) => s.time)).toEqual(["10:00", "13:00", "19:00"]); // Saturday
    expect(slots.filter((s) => s.dateKey === "2026-03-08").map((s) => s.time)).toEqual(["10:00", "13:00", "19:00"]); // Sunday
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
    expect(slot(slots, "2026-10-30 19:30").utc).toBe("2026-10-30T23:30:00.000Z"); // EDT
    expect(slot(slots, "2026-11-02 19:30").utc).toBe("2026-11-03T00:30:00.000Z"); // EST, next UTC day
  });

  it("marks slots earlier than now as past", () => {
    // 15:00Z on Mar 4 is 10:00 in Toronto — the 07:30 slot is gone.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z") });
    expect(slot(slots, "2026-03-04 07:30").past).toBe(true);
    expect(slot(slots, "2026-03-04 12:30").past).toBe(false);
  });

  it("flags only the first day as today, including past slots on that day", () => {
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-04T15:00:00Z") });
    expect(slots.filter((s) => s.today).map((s) => s.id)).toEqual([
      "2026-03-04 07:30",
      "2026-03-04 12:30",
      "2026-03-04 19:30"
    ]);
  });

  it("starts from the local calendar date, not the UTC one", () => {
    // 02:00Z on Mar 5 is still 21:00 Mar 4 in Toronto.
    const slots = generateSlots({ timeZone: TZ, now: new Date("2026-03-05T02:00:00Z") });
    expect(slots[0].dateKey).toBe("2026-03-04");
    expect(slots[0].today).toBe(true);
  });
});
