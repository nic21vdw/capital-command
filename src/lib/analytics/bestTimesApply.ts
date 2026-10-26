import type { AccountSlots } from "@/lib/analytics/bestTimes";
import type { CadenceInput } from "@/lib/automations/cadenceInput";

export function cadenceFromSuggestion(account: AccountSlots): CadenceInput | null {
  const input: CadenceInput = {};
  if (account.weekday.status === "ready") input.slotTimes = account.weekday.times;
  if (account.weekend.status === "ready") input.weekendSlotTimes = account.weekend.times;
  return Object.keys(input).length > 0 ? input : null;
}
