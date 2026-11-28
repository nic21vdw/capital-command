import { metricsAtAge } from "@/lib/analytics/atAge";
import { engagements } from "@/lib/analytics/metrics";
import { accountKey, type MetricValues, type PostRecord } from "@/lib/analytics/types";
import type { ExternalPost, Winner, WinnerEvidence, WinnerMetric } from "@/lib/winners/types";

const DAY = 86_400_000;

export const WINNER_RATIO = 2;
export const WINNER_LOOKBACK_DAYS = 30;
export const BASELINE_LOOKBACK_DAYS = 120;
export const COMPARE_AT_DAYS = 7;
export const MIN_AGE_DAYS = 1;
export const MIN_PEERS = 10;
export const MIN_VALUE: Record<WinnerMetric, number> = { views: 200, engagements: 10 };

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function valueOf(metrics: MetricValues | null | undefined, metric: WinnerMetric): number | null {
  if (!metrics) return null;
  if (metric === "views") return typeof metrics.views === "number" ? metrics.views : null;
  return engagements(metrics);
}

export function metricFor(posts: PostRecord[]): WinnerMetric {
  return posts.some((post) => typeof post.latest?.metrics.views === "number") ? "views" : "engagements";
}

function ageMs(post: PostRecord, now: Date): number {
  return now.getTime() - Date.parse(post.publishedAt);
}

function valueAt(post: PostRecord, age: number, metric: WinnerMetric, allowLatest: boolean): number | null {
  const at = valueOf(metricsAtAge(post, age), metric);
  if (at !== null) return at;
  return allowLatest ? valueOf(post.latest?.metrics, metric) : null;
}

function usable(post: PostRecord): boolean {
  return post.status === "ok" && post.latest !== null && post.format !== "long-form";
}

export function findWinners(posts: PostRecord[], now: Date, external: ExternalPost[] = []): Winner[] {
  const byAccount = new Map<string, PostRecord[]>();
  for (const post of posts.filter(usable)) {
    const key = `${accountKey(post.platform, post.accountId)}:${post.format}`;
    byAccount.set(key, [...(byAccount.get(key) ?? []), post]);
  }

  const ideas = new Map<string, Winner>();
  const add = (ideaId: string, base: Omit<Winner, "evidence" | "bestRatio" | "ideaId">, evidence: WinnerEvidence) => {
    const current = ideas.get(ideaId) ?? { ideaId, ...base, evidence: [], bestRatio: 0 };
    current.evidence.push(evidence);
    current.bestRatio = Math.max(current.bestRatio, evidence.ratio);
    if (base.publishedAt < current.publishedAt) current.publishedAt = base.publishedAt;
    ideas.set(ideaId, current);
  };

  for (const group of byAccount.values()) {
    const metric = metricFor(group);
    const pool = group.filter((post) => ageMs(post, now) <= BASELINE_LOOKBACK_DAYS * DAY);
    for (const post of pool) {
      const age = ageMs(post, now);
      if (age < MIN_AGE_DAYS * DAY || age > WINNER_LOOKBACK_DAYS * DAY) continue;
      const compareAt = Math.min(age, COMPARE_AT_DAYS * DAY);
      const value = valueAt(post, compareAt, metric, true);
      if (value === null || value < MIN_VALUE[metric]) continue;
      const peerValues: number[] = [];
      for (const peer of pool) {
        if (peer === post || ageMs(peer, now) < compareAt) continue;
        const peerValue = valueAt(peer, compareAt, metric, false);
        if (peerValue !== null) peerValues.push(peerValue);
      }
      if (peerValues.length < MIN_PEERS) continue;
      const typical = median(peerValues);
      const ratio = value / Math.max(typical, 1);
      if (ratio < WINNER_RATIO) continue;
      add(
        post.itemId || post.key,
        { title: post.title, caption: post.caption, publishedAt: post.publishedAt },
        {
          platform: post.platform,
          postId: post.postId,
          metric,
          value: Math.round(value),
          median: typical,
          ratio: Math.round(ratio * 10) / 10,
          ageDays: Math.round((compareAt / DAY) * 10) / 10,
          peers: peerValues.length
        }
      );
    }
  }

  const xPosts = external.filter((post) => post.platform === "x" && Number.isFinite(post.views));
  if (xPosts.length >= MIN_PEERS) {
    for (const post of xPosts) {
      const age = now.getTime() - Date.parse(post.postedAt);
      if (!(age >= MIN_AGE_DAYS * DAY && age <= WINNER_LOOKBACK_DAYS * DAY)) continue;
      const typical = median(xPosts.filter((other) => other !== post).map((other) => other.views));
      const ratio = post.views / Math.max(typical, 1);
      if (ratio < WINNER_RATIO || post.views < MIN_VALUE.views) continue;
      add(
        `x:${post.id}`,
        { title: post.text.split("\n")[0] ?? post.text, caption: post.text, publishedAt: post.postedAt },
        {
          platform: "x",
          postId: post.id,
          metric: "views",
          value: post.views,
          median: typical,
          ratio: Math.round(ratio * 10) / 10,
          ageDays: Math.round((age / DAY) * 10) / 10,
          peers: xPosts.length - 1
        }
      );
    }
  }

  return [...ideas.values()].sort((a, b) => b.bestRatio - a.bestRatio);
}
