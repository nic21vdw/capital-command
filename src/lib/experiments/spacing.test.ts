import { describe, expect, it } from "vitest";
import { VARIANT_GAP_MS, VariantSpacingError, assertVariantSpacing, spacingConflicts, type Placement } from "@/lib/experiments/spacing";

const HOUR = 3_600_000;
const START = Date.parse("2026-11-02T15:00:00.000Z");

function at(hoursAfter: number): string {
  return new Date(START + hoursAfter * HOUR).toISOString();
}

function placement(variantId: string, platform: string, hoursAfter: number, accountId = `${platform}-primary`): Placement {
  return { variantId, platform, accountId, at: at(hoursAfter) };
}

describe("the 48 hour rule", () => {
  it("is 48 hours", () => {
    expect(VARIANT_GAP_MS).toBe(48 * HOUR);
  });

  it("flags two variants on the same platform less than 48 hours apart", () => {
    const conflicts = spacingConflicts([placement("A", "youtube", 0), placement("B", "youtube", 47.9)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ platform: "youtube", first: { variantId: "A" }, second: { variantId: "B" } });
  });

  it("allows exactly 48 hours", () => {
    expect(spacingConflicts([placement("A", "youtube", 0), placement("B", "youtube", 48)])).toEqual([]);
  });

  it("allows the same moment on different platforms", () => {
    expect(spacingConflicts([placement("A", "youtube", 0), placement("B", "instagram", 0)])).toEqual([]);
  });

  it("allows two accounts of one platform to post close together", () => {
    expect(spacingConflicts([placement("A", "youtube", 0, "yt-main"), placement("B", "youtube", 2, "yt-second")])).toEqual([]);
  });

  it("does not count one variant against itself when it goes to several accounts or slots", () => {
    expect(spacingConflicts([placement("A", "youtube", 0), placement("A", "youtube", 3)])).toEqual([]);
  });

  it("finds every close pair in a run of three variants", () => {
    const conflicts = spacingConflicts([placement("A", "tiktok", 0), placement("B", "tiktok", 30), placement("C", "tiktok", 60)]);
    expect(conflicts.map((entry) => `${entry.first.variantId}${entry.second.variantId}`)).toEqual(["AB", "BC"]);
  });

  it("reports the gap in hours", () => {
    const [conflict] = spacingConflicts([placement("B", "youtube", 20), placement("A", "youtube", 0)]);
    expect(conflict.gapHours).toBe(20);
    expect(conflict.first.variantId).toBe("A");
  });

  it("ignores a placement whose time cannot be read", () => {
    expect(spacingConflicts([placement("A", "youtube", 0), { variantId: "B", platform: "youtube", accountId: "youtube-primary", at: "soon" }])).toEqual([]);
  });

  it("throws with the platform and the gap when asked to assert", () => {
    expect(() => assertVariantSpacing([placement("A", "instagram", 0), placement("B", "instagram", 24)])).toThrow(VariantSpacingError);
    expect(() => assertVariantSpacing([placement("A", "instagram", 0), placement("B", "instagram", 24)])).toThrow(/Instagram.*24 hours.*48/);
    expect(() => assertVariantSpacing([placement("A", "instagram", 0), placement("B", "instagram", 50)])).not.toThrow();
  });
});
