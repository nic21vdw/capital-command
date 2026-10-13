import type { AutomationCard } from "@/lib/automations/types";

/**
 * A card that is waiting on setup rather than doing or having done anything:
 * blocked by missing configuration, or nothing has ever run. Paused cards are
 * a choice the user made, so they stay in the main list.
 */
export function isNotSetUp(card: Pick<AutomationCard, "state">): boolean {
  return card.state === "blocked" || card.state === "unknown";
}
