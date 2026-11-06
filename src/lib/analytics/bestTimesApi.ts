import { learnBestTimes, type BestTimesReport } from "@/lib/analytics/bestTimes";
import { readMetrics } from "@/lib/analytics/store";
import { publisherConfig } from "@/lib/publisher/config";

export type BestTimesResponse = BestTimesReport & { current: { weekday: string[]; weekend: string[] } };

export async function bestTimesReport(now: Date = new Date()): Promise<BestTimesResponse> {
  const store = await readMetrics();
  const config = publisherConfig();
  const current = { weekday: config.slotTimes, weekend: config.weekendSlotTimes };
  const labels = Object.fromEntries(Object.values(store.accounts).map((account) => [account.key, account.label]));
  const report = learnBestTimes(Object.values(store.posts), { timeZone: config.timezone, now, current, labels });
  return { ...report, current };
}
