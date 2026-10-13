import { createHash } from "node:crypto";
import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { threadsConfig } from "@/lib/threads/config";
import type { HealthPlatformId } from "@/lib/platform-health/types";
import type { PlatformId } from "@/lib/publisher/types";

export function fingerprintOf(...credentials: Array<string | null | undefined>): string | null {
  const present = credentials.filter((value): value is string => Boolean(value));
  if (present.length === 0) return null;
  return createHash("sha256").update([...present].sort().join("\n")).digest("hex");
}

export function threadsFingerprint(accounts: Array<{ accessToken: string }>): string | null {
  return fingerprintOf(...accounts.map((account) => account.accessToken));
}

export function publisherFingerprint(platform: PlatformId, config: PublisherConfig): string | null {
  switch (platform) {
    case "youtube":
      return fingerprintOf(config.youtube.refreshToken);
    case "instagram":
      return fingerprintOf(config.instagram.accessToken);
    case "facebook":
      return fingerprintOf(config.facebook.pageAccessToken);
    case "tiktok":
      return fingerprintOf(config.tiktok.refreshToken);
  }
}

export function currentFingerprints(): Record<HealthPlatformId, string | null> {
  const publisher = publisherConfig();
  return {
    threads: threadsFingerprint(threadsConfig().accounts),
    youtube: publisherFingerprint("youtube", publisher),
    instagram: publisherFingerprint("instagram", publisher),
    facebook: publisherFingerprint("facebook", publisher),
    tiktok: publisherFingerprint("tiktok", publisher)
  };
}
