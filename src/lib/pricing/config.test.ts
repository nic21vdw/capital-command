import { describe, expect, it } from "vitest";
import { getCurrentTier, PRICING_TIERS, remainingInTier, TIER_1_LIMIT, TIER_2_LIMIT } from "@/lib/pricing/config";

describe("getCurrentTier", () => {
  it("starts at the Founder tier with zero sales", () => {
    expect(getCurrentTier(0).label).toBe("Founder");
    expect(getCurrentTier(0).priceCAD).toBe(199);
  });

  it("keeps Founder pricing until the ceiling is hit", () => {
    expect(getCurrentTier(TIER_1_LIMIT - 1).label).toBe("Founder");
  });

  it("moves to Early exactly at the Founder ceiling", () => {
    expect(getCurrentTier(TIER_1_LIMIT).label).toBe("Early");
    expect(getCurrentTier(TIER_1_LIMIT).priceCAD).toBe(299);
  });

  it("keeps Early pricing until the second ceiling", () => {
    expect(getCurrentTier(TIER_2_LIMIT - 1).label).toBe("Early");
  });

  it("moves to Standard at the second ceiling and stays there", () => {
    expect(getCurrentTier(TIER_2_LIMIT).label).toBe("Standard");
    expect(getCurrentTier(TIER_2_LIMIT).priceCAD).toBe(399);
    expect(getCurrentTier(10_000).label).toBe("Standard");
  });

  it("has strictly increasing prices and ceilings", () => {
    const prices = PRICING_TIERS.map((tier) => tier.priceCAD);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(TIER_1_LIMIT).toBeLessThan(TIER_2_LIMIT);
    expect(PRICING_TIERS.at(-1)?.upTo).toBeNull();
  });
});

describe("remainingInTier", () => {
  it("counts down within a tier", () => {
    expect(remainingInTier(0)).toBe(TIER_1_LIMIT);
    expect(remainingInTier(TIER_1_LIMIT - 1)).toBe(1);
    expect(remainingInTier(TIER_1_LIMIT)).toBe(TIER_2_LIMIT - TIER_1_LIMIT);
  });

  it("is unbounded on the final tier", () => {
    expect(remainingInTier(TIER_2_LIMIT)).toBeNull();
  });
});
