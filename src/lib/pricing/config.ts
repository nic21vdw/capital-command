/**
 * CoLateral one-time pricing. A license is perpetual — buy once, keep it.
 * The price steps up as cumulative licenses sell:
 *
 *   licenses 1..TIER_1_LIMIT             -> Founder  $199
 *   licenses TIER_1_LIMIT+1..TIER_2_LIMIT -> Early    $299
 *   licenses beyond TIER_2_LIMIT          -> Standard $399
 *
 * There is no backend and no live sales counter by design (zero recurring
 * cost). CURRENT_SOLD_COUNT is the single source of truth for what the page
 * shows: when a batch sells out on the payment platform, bump it here and
 * redeploy. Keep the checkout platform's limited-quantity products in sync
 * with these numbers so the advertised price always matches checkout.
 */

/** Cumulative license ceilings — tier N covers sales up to its ceiling. */
export const TIER_1_LIMIT = 10;
export const TIER_2_LIMIT = 25;

/** Bump manually as batches sell (see note above). */
export const CURRENT_SOLD_COUNT = 0;

/** Replace with the Gumroad / Lemon Squeezy product link before launch. */
export const CHECKOUT_URL = "REPLACE_WITH_CHECKOUT_URL";

export type PricingTier = {
  id: number;
  label: string;
  priceCAD: number;
  /** Cumulative sold-count ceiling; null = no ceiling (final tier). */
  upTo: number | null;
  blurb: string;
};

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    id: 1,
    label: "Founder",
    priceCAD: 199,
    upTo: TIER_1_LIMIT,
    blurb: `First ${TIER_1_LIMIT} licenses`
  },
  {
    id: 2,
    label: "Early",
    priceCAD: 299,
    upTo: TIER_2_LIMIT,
    blurb: `Licenses ${TIER_1_LIMIT + 1}–${TIER_2_LIMIT}`
  },
  {
    id: 3,
    label: "Standard",
    priceCAD: 399,
    upTo: null,
    blurb: `License ${TIER_2_LIMIT + 1} onward`
  }
] as const;

/** The tier the next sale falls into for a given cumulative sold count. */
export function getCurrentTier(sold: number = CURRENT_SOLD_COUNT): PricingTier {
  return (
    PRICING_TIERS.find((tier) => tier.upTo !== null && sold < tier.upTo) ??
    PRICING_TIERS[PRICING_TIERS.length - 1]
  );
}

/** Licenses left in the active tier, or null when the final tier is active. */
export function remainingInTier(sold: number = CURRENT_SOLD_COUNT): number | null {
  const tier = getCurrentTier(sold);
  return tier.upTo === null ? null : tier.upTo - sold;
}
