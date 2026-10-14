import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";

export const REVIEW_CHANNELS = ["youtube", "instagram", "tiktok", "facebook", "threads"] as const;
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

export const REVIEW_MODES = ["auto", "hold"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export type ReviewPolicy = Record<ReviewChannel, ReviewMode>;

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  youtube: "auto",
  instagram: "auto",
  tiktok: "auto",
  facebook: "auto",
  threads: "auto"
};

export type HeldSince = Partial<Record<ReviewChannel, string>>;

export function parseHeldSince(raw: unknown): HeldSince {
  const found: HeldSince = {};
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).heldSince : undefined;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return found;
  for (const channel of REVIEW_CHANNELS) {
    const value = (source as Record<string, unknown>)[channel];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) found[channel] = value;
  }
  return found;
}

export const HOLD_EVERYTHING: ReviewPolicy = {
  youtube: "hold",
  instagram: "hold",
  tiktok: "hold",
  facebook: "hold",
  threads: "hold"
};

export const REVIEW_CHANNEL_LABELS: Record<ReviewChannel, string> = {
  youtube: "YouTube Shorts",
  instagram: "Instagram Reels",
  tiktok: "TikTok",
  facebook: "Facebook Reels",
  threads: "Threads"
};

export function isReviewChannel(value: unknown): value is ReviewChannel {
  return typeof value === "string" && (REVIEW_CHANNELS as readonly string[]).includes(value);
}

export function isReviewMode(value: unknown): value is ReviewMode {
  return value === "auto" || value === "hold";
}

export function normalizeReviewPolicy(raw: unknown): ReviewPolicy {
  const policy: ReviewPolicy = { ...DEFAULT_REVIEW_POLICY };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return policy;
  for (const channel of REVIEW_CHANNELS) {
    const mode = (raw as Record<string, unknown>)[channel];
    if (isReviewMode(mode)) policy[channel] = mode;
  }
  return policy;
}

export function parseReviewPolicy(raw: unknown): ReviewPolicy | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const policy: ReviewPolicy = { ...DEFAULT_REVIEW_POLICY };
  for (const channel of REVIEW_CHANNELS) {
    const mode = (raw as Record<string, unknown>)[channel];
    if (mode === undefined) continue;
    if (!isReviewMode(mode)) return null;
    policy[channel] = mode;
  }
  return policy;
}

export function reviewChange(channel: ReviewChannel, mode: ReviewMode): Partial<ReviewPolicy> {
  const change: Partial<ReviewPolicy> = {};
  change[channel] = mode;
  return change;
}

export function policyHolds(policy: ReviewPolicy): boolean {
  return REVIEW_CHANNELS.some((channel) => policy[channel] === "hold");
}

export function legUnsent(leg: PlatformState): boolean {
  return (
    leg.status === "pending" &&
    leg.attempts === 0 &&
    !leg.postId &&
    !leg.containerId &&
    !leg.uploadedAt &&
    !leg.claimedAt
  );
}

export function legAwaitingApproval(leg: PlatformState, platform: PlatformId, policy: ReviewPolicy): boolean {
  return policy[platform] === "hold" && !leg.approvedAt && legUnsent(leg);
}

export type ReleaseSummary = { approved: number; moved?: unknown[]; unplaced?: unknown[] };

export function describeRelease(summary: ReleaseSummary): string {
  const moved = summary.moved?.length ?? 0;
  const unplaced = summary.unplaced?.length ?? 0;
  const parts = [`Approved ${summary.approved}.`];
  if (moved > 0) {
    parts.push(`${moved} moved to a later slot because the slot was more than a day old or that day was full.`);
  }
  if (unplaced > 0) parts.push(`${unplaced} had no free slot and stay on hold.`);
  return parts.join(" ");
}

export type LegHeld = (platform: PlatformId, leg: PlatformState) => boolean;

export function heldFrom(policy: ReviewPolicy): LegHeld {
  return (platform, leg) => legAwaitingApproval(leg, platform, policy);
}

export function itemAwaitingApproval(item: QueueItem, policy: ReviewPolicy): boolean {
  return (Object.entries(item.platforms) as [PlatformId, PlatformState][]).some(([platform, leg]) =>
    legAwaitingApproval(leg, platform, policy)
  );
}

export function threadsUnsent(item: ThreadsQueueItem): boolean {
  return item.status === "pending" && !(item.attempts > 0) && !item.lastFailedAt && !item.postId && !item.containerId && !item.claimedAt;
}

export function threadsAwaitingApproval(item: ThreadsQueueItem, policy: ReviewPolicy): boolean {
  return policy.threads === "hold" && !item.approvedAt && threadsUnsent(item);
}

export type AwaitingEntry = {
  key: string;
  channel: ReviewChannel;
  id: string;
  title: string;
  caption: string;
  publishAt: string;
  accountId?: string;
};
