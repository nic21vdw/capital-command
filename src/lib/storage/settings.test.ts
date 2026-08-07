import { describe, expect, it, vi } from "vitest";
import { settingsSchema } from "@/lib/storage/schemas";

// The gate lives in POST /api/pipeline, which needs a Next request to call. What
// is worth pinning here is the shape it reads: an absent setting must parse to
// "not allowed", because a missing answer has to mean no.
describe("the overnight scheduling setting", () => {
  it("is absent by default, and absent means no", () => {
    const parsed = settingsSchema.parse({ currency: "CAD" });
    expect(parsed.autoScheduleOvernight).toBeUndefined();
    expect(parsed.autoScheduleOvernight === true).toBe(false);
  });

  it("survives a round trip when it is on", () => {
    const parsed = settingsSchema.parse({ currency: "CAD", autoScheduleOvernight: true });
    expect(parsed.autoScheduleOvernight).toBe(true);
  });

  it("keeps every other setting untouched", () => {
    const parsed = settingsSchema.parse({ currency: "USD", themePreset: "midnight", autoScheduleOvernight: false });
    expect(parsed.currency).toBe("USD");
    expect(parsed.themePreset).toBe("midnight");
    expect(parsed.autoScheduleOvernight).toBe(false);
  });
});
