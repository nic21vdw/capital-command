import { describe, expect, it } from "vitest";
import { DEFAULT_SLOT_OFFSET_DAYS, SLOT_WINDOW_DAYS, slotOffsetForDateKey } from "@/lib/publisher/slotWindow";

describe("slotOffsetForDateKey", () => {
  it("keeps today in the default window", () => {
    expect(slotOffsetForDateKey("2026-08-13", "2026-08-13")).toBe(DEFAULT_SLOT_OFFSET_DAYS);
  });

  it("pages forward so a date months out is inside the two-week window", () => {
    const offset = slotOffsetForDateKey("2026-10-20", "2026-08-13");
    const daysOut = Math.round((Date.UTC(2026, 9, 20) - Date.UTC(2026, 7, 13)) / 86_400_000);
    expect(daysOut).toBeGreaterThanOrEqual(offset);
    expect(daysOut).toBeLessThan(offset + SLOT_WINDOW_DAYS);
    expect((offset - DEFAULT_SLOT_OFFSET_DAYS) % SLOT_WINDOW_DAYS).toBe(0);
  });
});
