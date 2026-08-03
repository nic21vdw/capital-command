import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { configuredPlatforms, publisherConfig } from "@/lib/publisher/config";
import { dataPath } from "@/lib/paths";
import { mediaHost } from "@/lib/publisher/hosting";
import { getCachedToken } from "@/lib/publisher/tokens";
import { ALL_PLATFORMS, type PlatformId, type QueueItem } from "@/lib/publisher/types";

/**
 * Social accounts for the Uploading Center: the same platform can be
 * connected more than once (several YouTube channels, TikTok profiles,
 * Instagram accounts…), and every scheduled post belongs to exactly one
 * account, so each account gets its own calendar.
 *
 * Every platform always has a built-in "primary" account that represents the
 * credentials configured today (.env variables and the original Connect
 * YouTube flow). Queue items without an accountId — everything scheduled
 * before accounts existed — belong to the primary account of their platform,
 * so nothing already uploaded or scheduled moves or disappears.
 *
 * Extra accounts are stored next to the queue (data/social-accounts.json, or
 * the same JSON in the R2 bucket when the queue lives there). Extra YouTube
 * accounts connect through the same in-app OAuth flow with per-account token
 * cache keys; extra TikTok/Instagram/Facebook accounts save posts as "manual"
 * reminders until per-account credentials exist for those platforms.
 */

export type SocialAccount = {
  id: string;
  platform: PlatformId;
  /** User-facing name, e.g. "Main channel" or "Clips channel". */
  label: string;
  createdAt: string;
};

const FILE_PATH = dataPath("social-accounts.json");
const R2_KEY = "publisher/social-accounts.json";

export function primaryAccountId(platform: PlatformId): string {
  return `${platform}-primary`;
}

export function isPrimaryAccountId(accountId: string): boolean {
  return ALL_PLATFORMS.some((platform) => accountId === primaryAccountId(platform));
}

/** The account a queue item belongs to on a platform (legacy items → primary). */
export function itemAccountId(item: Pick<QueueItem, "accountId">, platform: PlatformId): string {
  return item.accountId ?? primaryAccountId(platform);
}

export function itemBelongsToAccount(item: QueueItem, platform: PlatformId, accountId: string): boolean {
  return Boolean(item.platforms[platform]) && itemAccountId(item, platform) === accountId;
}

/**
 * Token-cache keys for a YouTube account. The primary account keeps the
 * original un-suffixed keys so connections made before accounts existed keep
 * working; extra accounts get their own suffixed entries.
 */
export function youtubeRefreshTokenKey(accountId: string = primaryAccountId("youtube")): string {
  return accountId === primaryAccountId("youtube") ? "youtube.refreshToken" : `youtube.refreshToken.${accountId}`;
}

export function youtubeChannelKey(accountId: string = primaryAccountId("youtube")): string {
  return accountId === primaryAccountId("youtube") ? "youtube.channel" : `youtube.channel.${accountId}`;
}

function primaryAccount(platform: PlatformId): SocialAccount {
  return {
    id: primaryAccountId(platform),
    platform,
    label: "Primary",
    // Fixed epoch so primaries always sort ahead of added accounts.
    createdAt: "1970-01-01T00:00:00.000Z"
  };
}

/**
 * The full account list: the four built-in primaries plus whatever was added,
 * ordered platform-first (in ALL_PLATFORMS order) then oldest-first. A stored
 * entry that collides with a primary id or an unknown platform is dropped.
 */
export function withPrimaries(stored: SocialAccount[]): SocialAccount[] {
  const extras = stored.filter(
    (account) =>
      (ALL_PLATFORMS as string[]).includes(account.platform) &&
      !isPrimaryAccountId(account.id) &&
      account.id &&
      account.label
  );
  const all = [...ALL_PLATFORMS.map(primaryAccount), ...extras];
  return all.sort(
    (a, b) =>
      ALL_PLATFORMS.indexOf(a.platform) - ALL_PLATFORMS.indexOf(b.platform) ||
      a.createdAt.localeCompare(b.createdAt)
  );
}

async function readStored(): Promise<SocialAccount[]> {
  const config = publisherConfig();
  try {
    if (config.queueBackend === "r2") {
      const host = mediaHost(config);
      const text = host ? await host.getObjectText(R2_KEY) : null;
      return text ? (JSON.parse(text) as SocialAccount[]) : [];
    }
    return JSON.parse(await readFile(FILE_PATH, "utf8")) as SocialAccount[];
  } catch {
    return [];
  }
}

async function writeStored(accounts: SocialAccount[]): Promise<void> {
  const config = publisherConfig();
  const text = JSON.stringify(accounts, null, 2);
  if (config.queueBackend === "r2") {
    const host = mediaHost(config);
    if (host) {
      await host.putObjectText(R2_KEY, text);
      return;
    }
  }
  await mkdir(path.dirname(FILE_PATH), { recursive: true });
  await writeFile(FILE_PATH, text, "utf8");
}

export async function listAccounts(): Promise<SocialAccount[]> {
  return withPrimaries(await readStored());
}

export async function getAccount(accountId: string): Promise<SocialAccount | null> {
  return (await listAccounts()).find((account) => account.id === accountId) ?? null;
}

export async function addAccount(platform: PlatformId, label: string): Promise<SocialAccount> {
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) throw new Error("Give the account a name (e.g. the channel or handle).");
  const account: SocialAccount = {
    id: `${platform}-${crypto.randomUUID().slice(0, 8)}`,
    platform,
    label: trimmed,
    createdAt: new Date().toISOString()
  };
  await writeStored([...(await readStored()), account]);
  return account;
}

export async function renameAccount(accountId: string, label: string): Promise<SocialAccount> {
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) throw new Error("The account name cannot be empty.");
  if (isPrimaryAccountId(accountId)) throw new Error("The primary account cannot be renamed.");
  const stored = await readStored();
  const account = stored.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error("No such account.");
  account.label = trimmed;
  await writeStored(stored);
  return account;
}

/**
 * Removes an added account. Primaries are permanent, and an account with
 * scheduled posts refuses to go — remove those posts first so no calendar
 * entry is ever orphaned.
 */
export async function removeAccount(accountId: string, queueItems: QueueItem[]): Promise<void> {
  if (isPrimaryAccountId(accountId)) throw new Error("The primary account cannot be removed.");
  if (queueItems.some((item) => item.accountId === accountId)) {
    throw new Error("This account still has scheduled posts — remove them from the calendar first.");
  }
  const stored = await readStored();
  if (!stored.some((candidate) => candidate.id === accountId)) throw new Error("No such account.");
  await writeStored(stored.filter((candidate) => candidate.id !== accountId));
}

/**
 * Whether posts for this platform+account publish automatically. The primary
 * account is configured exactly when today's env credentials are; an extra
 * YouTube account is configured once its own Connect YouTube flow ran. Extra
 * accounts on other platforms always post as manual reminders for now.
 */
export async function accountIdConfigured(
  platform: PlatformId,
  accountId?: string,
  config = publisherConfig()
): Promise<boolean> {
  const resolved = accountId ?? primaryAccountId(platform);
  if (resolved === primaryAccountId(platform)) {
    return configuredPlatforms(config).includes(platform);
  }
  if (platform === "youtube") {
    return Boolean(
      config.youtube.clientId && config.youtube.clientSecret && (await getCachedToken(youtubeRefreshTokenKey(resolved)))
    );
  }
  return false;
}
