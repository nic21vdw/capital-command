import type { PlatformId } from "@/lib/publisher/types";

type AccountLike = { platform: PlatformId; connected: boolean };

export function linkedinTabVisible(accounts: AccountLike[], itemCountByPlatform: ReadonlyMap<PlatformId, number>): boolean {
  return (
    accounts.some((account) => account.platform === "linkedin" && account.connected) ||
    (itemCountByPlatform.get("linkedin") ?? 0) > 0
  );
}

export function visiblePlatformTabs<T extends { id: PlatformId }>(
  tabs: T[],
  accounts: AccountLike[],
  itemCountByPlatform: ReadonlyMap<PlatformId, number>
): T[] {
  const showLinkedin = linkedinTabVisible(accounts, itemCountByPlatform);
  return tabs.filter((tab) => tab.id !== "linkedin" || showLinkedin);
}
