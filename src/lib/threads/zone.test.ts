import { describe, expect, it } from "vitest";
import { fromZonedInput, threadsClock, toZonedInput, zoneNote, zonedDateKey } from "@/lib/threads/zone";

describe("threads zone helpers", () => {
  const TORONTO = "America/Toronto";

  it("shows a slot on the autopilot's clock, not the machine's", () => {
    // 8:00 PM EDT is midnight UTC; a UTC browser must still read 8:00 PM.
    expect(threadsClock("2026-10-11T00:00:00Z", TORONTO)).toMatch(/8:00\s?PM/i);
    expect(threadsClock("2026-10-11T00:00:00Z", "UTC")).toMatch(/12:00\s?AM/i);
  });

  it("round-trips a datetime-local value through the configured zone", () => {
    const iso = "2026-10-11T00:00:00.000Z";
    expect(toZonedInput(iso, TORONTO)).toBe("2026-10-10T20:00");
    expect(fromZonedInput("2026-10-10T20:00", TORONTO)?.toISOString()).toBe(iso);
    expect(fromZonedInput("", TORONTO)).toBeNull();
  });

  it("reads the calendar day in the configured zone", () => {
    expect(zonedDateKey(TORONTO, new Date("2026-10-11T02:00:00Z"))).toBe("2026-10-10");
  });

  it("names the zone only when the browser is somewhere else", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(zoneNote(TORONTO, "UTC", now)).toBe("Times in Toronto time (EDT)");
    expect(zoneNote(TORONTO, TORONTO, now)).toBeNull();
    expect(zoneNote(TORONTO, null, now)).toBeNull();
  });
});
