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

export type PlatformAuthState = {
  platform: HealthPlatformId;
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
  label: string;
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
