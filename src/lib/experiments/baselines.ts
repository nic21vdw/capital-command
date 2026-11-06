import { metricsAtAge } from "@/lib/analytics/atAge";
import { engagementRate } from "@/lib/analytics/metrics";
import { accountKey, type PostRecord } from "@/lib/analytics/types";
import { MIN_BASELINE_POSTS } from "@/lib/experiments/types";

export type Baseline = { views: number; engagementRate: number | null; posts: number };

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function accountBaselines(posts: PostRecord[], ageMs: number, excludeItemIds: Set<string>): Map<string, Baseline> {
  const views = new Map<string, number[]>();
  const rates = new Map<string, number[]>();
  for (const post of posts) {
    if (post.status === "unsupported" || post.status === "gone" || excludeItemIds.has(post.itemId)) continue;
    const metrics = metricsAtAge(post, ageMs);
    if (!metrics || typeof metrics.views !== "number") continue;
    const key = accountKey(post.platform, post.accountId);
    views.set(key, [...(views.get(key) ?? []), metrics.views]);
    const rate = engagementRate(metrics);
    if (rate !== null) rates.set(key, [...(rates.get(key) ?? []), rate]);
  }
  const baselines = new Map<string, Baseline>();
  for (const [key, list] of views) {
    if (list.length < MIN_BASELINE_POSTS) continue;
    const typical = median(list);
    if (typical <= 0) continue;
    const rateList = rates.get(key) ?? [];
    const typicalRate = rateList.length >= MIN_BASELINE_POSTS ? median(rateList) : 0;
    baselines.set(key, { views: typical, engagementRate: typicalRate > 0 ? typicalRate : null, posts: list.length });
  }
  return baselines;
}
