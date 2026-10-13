import { accountIdConfigured, listAccounts, primaryAccountId } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import type { PlatformId } from "@/lib/publisher/types";

/** Whether the account a post uses on a platform has a connection that publishes for it. */
export type LegConnected = (platform: PlatformId, accountId: string) => boolean;

/**
 * The rule the Uploading Center applies to every leg, computed on the server
 * from the same source as /api/publish/accounts (`accountIdConfigured`, without
 * the profile lookups): a post's account on a platform, else that platform's
 * primary account. Nothing is claimed unconnected until the account list is
 * known, so an empty list answers "connected". A list that cannot be read
 * answers the same, rather than flagging every post.
 */
export function legConnectedFrom(accounts: { id: string; platform: PlatformId; connected: boolean }[]): LegConnected {
  return (platform, accountId) => {
    if (accounts.length === 0) return true;
    const own =
      accounts.find((account) => account.platform === platform && account.id === accountId) ??
      accounts.find((account) => account.platform === platform && account.id === primaryAccountId(platform));
    return own?.connected ?? false;
  };
}

export async function legConnectionCheck(config = publisherConfig()): Promise<LegConnected> {
  try {
    const accounts = await listAccounts();
    const withState = await Promise.all(
      accounts.map(async (account) => ({
        id: account.id,
        platform: account.platform,
        connected: await accountIdConfigured(account.platform, account.id, config)
      }))
    );
    return legConnectedFrom(withState);
  } catch {
    return () => true;
  }
}
