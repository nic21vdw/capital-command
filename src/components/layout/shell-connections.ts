import { z } from "zod";
import type { PlatformIconKey } from "@/components/ui/platform-icon";

type PlatformKey = PlatformIconKey;
const OTHER_PLATFORMS: PlatformKey[] = ["instagram", "tiktok", "facebook"];

export type Profile = { title: string; thumbnail: string | null; handle?: string | null };

/** One platform's standing: who it posts as, and whether it can. */
export type PlatformConnection = {
  platform: PlatformKey;
  profile: Profile | null;
  /** How many accounts on this platform are signed in. */
  connected: number;
  /** Signed in, but something still stops it publishing unattended. */
  blocker: string | null;
  /** The account whose last post died on an expired or revoked connection, if any. */
  reconnectAccountId: string | null;
};

export type ChannelSummary = Profile & {
  /** How many other connected YouTube accounts exist beyond this one. */
  extraConnected: number;
  /** Set when this channel's last post failed on the connection: "connected" is no longer true in practice. */
  reconnect: boolean;
};

/** Every platform the app can publish as, and whether it is signed in. */
export type Connections = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** The YouTube channel this whole pipeline publishes as, when signed in. */
  channel: ChannelSummary | null;
  /** The non-YouTube platforms, in the order the sidebar lists them. */
  others: PlatformConnection[];
};

export type AccountRow = {
  id: string;
  platform: string;
  primary: boolean;
  connected: boolean;
  profile?: Profile | null;
  blocker?: string | null;
  needsReconnect?: boolean;
  youtube: Profile | null;
  tiktok?: Profile | null;
};

export const CHANNEL_CACHE_KEY = "capital-command:connected-accounts:v2";
export const CHANNEL_CACHE_TTL_MS = 60_000;
export const CONNECTIONS_TIMEOUT_MS = 20_000;
export const EMPTY_CONNECTIONS: Connections = { loaded: false, loading: true, error: null, channel: null, others: [] };

const profileSchema = z.object({
  title: z.string(),
  thumbnail: z.string().nullable(),
  handle: z.string().nullable().optional()
});
const accountsSchema = z.object({
  accounts: z.array(z.object({
    id: z.string().min(1),
    // New publishing platforms may arrive before this shell has a chip for them.
    platform: z.string().min(1),
    primary: z.boolean(),
    connected: z.boolean(),
    profile: profileSchema.nullable().optional(),
    blocker: z.string().nullable().optional(),
    needsReconnect: z.boolean().optional(),
    youtube: profileSchema.nullable(),
    tiktok: profileSchema.nullable().optional()
  }))
});

export function parseAccountRows(value: unknown): AccountRow[] {
  return accountsSchema.parse(value).accounts;
}

/** Never replace the last known accounts with a guessed empty list. */
export function connectionsFailed(previous: Connections): Connections {
  return { ...previous, loading: false, error: previous.loaded ? "Account status out of date" : "Account status unavailable" };
}

export function readConnectionsCache(raw: string | null): { at: number; accounts: AccountRow[] } | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const cache = z.object({ at: z.number().finite().nonnegative(), accounts: z.unknown() }).parse(value);
    return { at: cache.at, accounts: parseAccountRows({ accounts: cache.accounts }) };
  } catch {
    return null;
  }
}

export async function fetchAccountRows(): Promise<AccountRow[]> {
  const response = await fetch("/api/publish/accounts", {
    cache: "no-store",
    signal: AbortSignal.timeout(CONNECTIONS_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error("Could not read account status");
  return parseAccountRows(await response.json());
}

function profileOf(account: AccountRow): Profile | null {
  return account.profile ?? account.youtube ?? account.tiktok ?? null;
}

function connectedOn(accounts: AccountRow[], platform: string) {
  return accounts.filter((account) => account.platform === platform && account.connected);
}

export function summarize(accounts: AccountRow[]): Connections {
  const youtube = connectedOn(accounts, "youtube").filter((account) => profileOf(account));
  // The primary channel is the face of the app; any primary-connected account
  // wins, otherwise the first connected one does.
  const lead = youtube.find((account) => account.primary) ?? youtube[0];
  const leadProfile = lead ? profileOf(lead) : null;
  return {
    loaded: true,
    loading: false,
    error: null,
    channel: leadProfile
      ? { ...leadProfile, extraConnected: youtube.length - 1, reconnect: Boolean(lead?.needsReconnect) }
      : null,
    others: OTHER_PLATFORMS.map((platform) => {
      const signedIn = connectedOn(accounts, platform);
      return {
        platform,
        profile: signedIn.map(profileOf).find(Boolean) ?? null,
        connected: signedIn.length,
        blocker: signedIn.map((account) => account.blocker).find(Boolean) ?? null,
        reconnectAccountId: signedIn.find((account) => account.needsReconnect)?.id ?? null
      };
    })
  };
}
