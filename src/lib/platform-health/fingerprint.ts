import { createHash } from "node:crypto";
import {
  getAccount,
  isPrimaryAccountId,
  primaryAccountId,
  tiktokRefreshTokenKey,
  youtubeRefreshTokenKey
} from "@/lib/publisher/accounts";
import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { getCachedToken } from "@/lib/publisher/tokens";
import type { PlatformId } from "@/lib/publisher/types";
import { threadsConfig } from "@/lib/threads/config";
import type { HealthPlatformId } from "@/lib/platform-health/types";

export function fingerprintOf(...credentials: Array<string | null | undefined>): string | null {
  const present = credentials.filter((value): value is string => Boolean(value));
  if (present.length === 0) return null;
  return createHash("sha256").update([...present].sort().join("\n")).digest("hex");
}

export function threadsAccountFingerprint(account: { accessToken: string }): string | null {
  return fingerprintOf(account.accessToken);
}

function primaryFingerprint(platform: PlatformId, config: PublisherConfig): string | null {
  switch (platform) {
    case "youtube":
      return fingerprintOf(config.youtube.refreshToken);
    case "instagram":
      return fingerprintOf(config.instagram.accessToken);
    case "facebook":
      return fingerprintOf(config.facebook.pageAccessToken);
    case "tiktok":
      return fingerprintOf(config.tiktok.refreshToken);
    case "linkedin":
      return fingerprintOf(config.linkedin.accessToken ?? config.linkedin.refreshToken);
  }
}

export async function publisherAccountFingerprint(
  platform: PlatformId,
  accountId: string = primaryAccountId(platform),
  config: PublisherConfig = publisherConfig()
): Promise<string | null> {
  if (isPrimaryAccountId(accountId)) return primaryFingerprint(platform, config);
  if (platform === "youtube") return fingerprintOf(await getCachedToken(youtubeRefreshTokenKey(accountId)));
  if (platform === "tiktok") return fingerprintOf(await getCachedToken(tiktokRefreshTokenKey(accountId)));
  return null;
}

export async function currentFingerprint(
  platform: HealthPlatformId,
  accountId: string
): Promise<string | null | undefined> {
  if (platform === "threads") {
    const account = threadsConfig().accounts.find((candidate) => candidate.id === accountId);
    return account ? threadsAccountFingerprint(account) : undefined;
  }
  if (!isPrimaryAccountId(accountId) && !(await getAccount(accountId))) return undefined;
  return publisherAccountFingerprint(platform, accountId);
}
