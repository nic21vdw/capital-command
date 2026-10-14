import type { PlatformId } from "@/lib/publisher/types";

export type HealthPlatformId = "threads" | PlatformId;

export const HEALTH_PLATFORMS: HealthPlatformId[] = ["threads", "youtube", "instagram", "facebook", "tiktok"];

export const PLATFORM_HEALTH_LABEL: Record<HealthPlatformId, string> = {
  threads: "Threads",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok"
};

export const RECONNECT_URL = "/settings#accounts";

export type AuthTarget = {
  platform: HealthPlatformId;
  accountId: string;
  accountLabel?: string | null;
};

export type PlatformAuthState = {
  platform: HealthPlatformId;
  accountId: string;
  accountLabel: string | null;
  since: string;
  lastFailureAt: string;
  reason: string;
  fixUrl: string;
  fingerprint: string | null;
  nextProbeAt: string;
  failures: number;
};

export type BrokenPlatform = {
  platform: HealthPlatformId;
  accountId: string;
  label: string;
  displayName: string;
  since: string;
  lastFailureAt: string;
  reason: string;
  fixUrl: string;
  failures: number;
};

export type PlatformHealthResponse = {
  ok: boolean;
  checkedAt: string;
  broken: BrokenPlatform[];
};

export function authStateKey(platform: HealthPlatformId, accountId: string): string {
  return `${platform}:${accountId}`;
}

export function accountDisplayName(platform: HealthPlatformId, accountLabel: string | null | undefined): string {
  const label = PLATFORM_HEALTH_LABEL[platform];
  return accountLabel ? `${label} · ${accountLabel}` : label;
}
