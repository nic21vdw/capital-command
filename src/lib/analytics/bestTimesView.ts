import type { AccountSlots, SlotSuggestion } from "@/lib/analytics/bestTimes";
import { PLATFORM_LABEL, accountKey } from "@/lib/analytics/types";

export function accountOptionLabel(account: AccountSlots): string {
  const platform = PLATFORM_LABEL[account.platform];
  return account.label ? `${platform}: ${account.label}` : `${platform} (${account.accountId})`;
}

export function accountOptionKey(account: AccountSlots): string {
  return accountKey(account.platform, account.accountId);
}

export function defaultAccountKey(accounts: AccountSlots[]): string | null {
  if (accounts.length === 0) return null;
  const best = [...accounts].sort((a, b) => b.posts - a.posts)[0];
  return accountOptionKey(best);
}

export function suggestionAvailable(account: AccountSlots): boolean {
  return account.weekday.status === "ready" || account.weekend.status === "ready";
}

export function slotSummaryLine(label: string, suggestion: SlotSuggestion): string {
  if (suggestion.status === "unchanged") return `${label}: the current slots already match your best hours`;
  if (suggestion.status === "not-enough-data") {
    const reason = (suggestion.reason ?? "").replace(/^Not enough data yet:\s*/i, "");
    return `${label}: not enough data yet.${reason ? ` ${reason}` : ""}`;
  }
  const detail = [`${suggestion.confidence ?? "low"} confidence`, suggestion.basis ?? ""].filter(Boolean);
  if (suggestion.gainPercent !== null) detail.push(`about ${suggestion.gainPercent}% more views at 48 hours than the current slots`);
  return `${label}: ${suggestion.times.join(", ")} (${detail.join("; ")})`;
}
