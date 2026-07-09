import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CHECKOUT_URL, CURRENT_SOLD_COUNT, getCurrentTier, PRICING_TIERS, remainingInTier } from "@/lib/pricing/config";

const INCLUDED = [
  "One-time payment, yours forever",
  "All current features and bug fixes",
  "Bring your own Claude account for AI",
  "Bring your own cloud storage for sync",
  "No subscription, no account, no data held by us"
];

/**
 * Renders the tiered one-time pricing. Everything derives from
 * src/lib/pricing/config.ts — bump CURRENT_SOLD_COUNT there as batches sell.
 */
export function PricingTiers() {
  const activeTier = getCurrentTier();
  const remaining = remainingInTier();
  const nextTier = PRICING_TIERS.find((tier) => tier.id === activeTier.id + 1);
  const checkoutReady = CHECKOUT_URL.startsWith("http");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {PRICING_TIERS.map((tier) => {
          const isActive = tier.id === activeTier.id;
          const isSoldOut = tier.upTo !== null && CURRENT_SOLD_COUNT >= tier.upTo;
          return (
            <Card
              key={tier.id}
              className={cn(
                "relative flex flex-col",
                isActive && "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent),var(--shadow)]"
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">{tier.label}</h2>
                {isActive && <Badge className="border-[var(--accent)] text-[var(--accent)]">Current price</Badge>}
                {isSoldOut && <Badge>Sold out</Badge>}
                {!isActive && !isSoldOut && <Badge>Upcoming</Badge>}
              </div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{tier.blurb}</p>
              <p className={cn("mt-4 text-4xl font-bold tracking-tight", isActive ? "text-white" : "text-[var(--muted-foreground)]", isSoldOut && "line-through")}>
                ${tier.priceCAD}
                <span className="ml-1 text-sm font-normal text-[var(--muted-foreground)]">CAD, one time</span>
              </p>
              {isActive && (
                <div className="mt-4">
                  {checkoutReady ? (
                    <a
                      href={CHECKOUT_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition hover:bg-[var(--accent-strong)]"
                    >
                      Buy CoLateral — ${tier.priceCAD}
                    </a>
                  ) : (
                    <p className="rounded-lg border border-dashed border-[var(--border-strong)] p-3 text-center text-sm text-[var(--muted-foreground)]">
                      Checkout link coming soon.
                    </p>
                  )}
                  {remaining !== null && (
                    <p className="mt-2 text-center text-xs text-amber-200">
                      {remaining} of {tier.upTo} {tier.label} licenses left
                      {nextTier ? ` — price rises to $${nextTier.priceCAD} after this batch` : ""}
                    </p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <Card>
        <h2 className="text-lg font-semibold text-white">Every license includes</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {INCLUDED.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-[var(--muted-foreground)]">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" /> {line}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
