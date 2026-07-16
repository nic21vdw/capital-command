import { primaryAccountId, youtubeChannelKey, youtubeRefreshTokenKey } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import { getCachedToken, setCachedToken } from "@/lib/publisher/tokens";

/**
 * Google OAuth 2.0 for the in-app "Connect YouTube" button. The whole flow
 * stays on the backend: the browser only ever sees Google's consent screen
 * and a redirect back to the Uploading Center. The client secret comes from
 * .env and the refresh token is persisted via tokens.ts
 * (data/publisher-tokens.json) — nothing sensitive reaches the front end,
 * localStorage, or a URL. This tool runs on localhost only, which is why the
 * redirect URI is derived from the local request origin.
 *
 * Multi-account: every YouTube account in accounts.ts connects through this
 * same flow. The target account id rides along in the OAuth state parameter
 * and picks the token-cache keys — the primary account keeps the original
 * un-suffixed keys, extra accounts get per-account entries — so each
 * connected channel refreshes and uploads with its own credentials.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// youtube.readonly is used both to read the connected channel's name/avatar
// for the "YouTube connected" badge and to list the channel's own uploads so
// the Uploading Center can show what is already scheduled on YouTube itself.
// Tokens minted before readonly was added still upload fine but fail channel
// reads with a 403 — the UI surfaces that as a "reconnect" prompt.
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

export const YOUTUBE_REFRESH_TOKEN_CACHE_KEY = youtubeRefreshTokenKey();
export const YOUTUBE_CHANNEL_CACHE_KEY = youtubeChannelKey();

/** Stable, user-safe reason recorded when Google revokes an OAuth grant. */
export const YOUTUBE_RECONNECT_REQUIRED =
  "YouTube connection expired or was revoked. Reconnect YouTube to resume the upload automatically.";

export function isYoutubeReconnectRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_grant|token has been expired or revoked/i.test(message);
}

export type YoutubeChannelInfo = { title: string; thumbnail: string | null };

export function googleAuthUrl(redirectUri: string, accountId: string = primaryAccountId("youtube")): string {
  const { youtube } = publisherConfig();
  if (!youtube.clientId || !youtube.clientSecret) {
    throw new Error(
      "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first (Google Cloud Console → OAuth client, type Web application, redirect URI " +
        `${redirectUri}).`
    );
  }
  const params = new URLSearchParams({
    client_id: youtube.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Force the consent screen so Google always returns a refresh token,
    // even when the account approved this client before.
    prompt: "consent",
    // Which of our accounts this connection is for — echoed back on the
    // callback so the tokens land under that account's cache keys.
    state: accountId
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchanges the callback code and persists the refresh token backend-side. */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  accountId: string = primaryAccountId("youtube")
): Promise<void> {
  const { youtube } = publisherConfig();
  if (!youtube.clientId || !youtube.clientSecret) {
    throw new Error("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not configured.");
  }
  const data = await fetchJson<{ refresh_token?: string; access_token?: string }>(TOKEN_URL, {
    label: "Google OAuth code exchange",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: youtube.clientId,
      client_secret: youtube.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });
  if (!data.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Remove the app's access at https://myaccount.google.com/permissions and connect again."
    );
  }
  await setCachedToken(youtubeRefreshTokenKey(accountId), data.refresh_token);
  channelLookupFailed.delete(accountId);
  if (data.access_token) {
    try {
      const info = await fetchChannelInfo(data.access_token);
      if (info) await setCachedToken(youtubeChannelKey(accountId), JSON.stringify(info));
    } catch {
      // The badge falls back to plain "YouTube connected"; the connection itself succeeded.
    }
  }
}

async function fetchChannelInfo(accessToken: string): Promise<YoutubeChannelInfo | null> {
  const data = await fetchJson<{
    items?: Array<{ snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }>;
  }>(CHANNELS_URL, {
    label: "YouTube channel lookup",
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const snippet = data.items?.[0]?.snippet;
  if (!snippet?.title) return null;
  const thumbnail = snippet.thumbnails?.default?.url ?? snippet.thumbnails?.medium?.url ?? null;
  return { title: snippet.title, thumbnail };
}

/**
 * The account's stored refresh token. A token minted by Connect YouTube wins
 * over .env so reconnecting can actually replace an expired/revoked primary
 * credential; .env remains the fallback for setups that have never connected
 * through the app.
 */
export async function youtubeRefreshTokenFor(accountId: string = primaryAccountId("youtube")): Promise<string | null> {
  const cached = await getCachedToken(youtubeRefreshTokenKey(accountId));
  if (cached) return cached;
  if (accountId === primaryAccountId("youtube")) {
    const { youtube } = publisherConfig();
    if (youtube.refreshToken) return youtube.refreshToken;
  }
  return null;
}

// Connections made before the badge showed the channel lack the readonly
// scope, so the lazy lookup below would 403 on every overview poll — remember
// the failure per account for this process instead of hammering Google.
const channelLookupFailed = new Set<string>();

/**
 * A connected account's channel name and avatar for the UI. Served from the
 * token cache; when absent (connection predates this feature) it is fetched
 * once with the account's stored refresh token and cached.
 */
export async function youtubeChannelInfo(
  accountId: string = primaryAccountId("youtube")
): Promise<YoutubeChannelInfo | null> {
  const cached = await getCachedToken(youtubeChannelKey(accountId));
  if (cached) {
    try {
      return JSON.parse(cached) as YoutubeChannelInfo;
    } catch {
      // Corrupt cache entry — refetch below.
    }
  }
  if (channelLookupFailed.has(accountId)) return null;
  const { youtube } = publisherConfig();
  const refreshToken = await youtubeRefreshTokenFor(accountId);
  if (!youtube.clientId || !youtube.clientSecret || !refreshToken) return null;
  try {
    const token = await fetchJson<{ access_token: string }>(TOKEN_URL, {
      label: "YouTube token refresh",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: youtube.clientId,
        client_secret: youtube.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });
    const info = await fetchChannelInfo(token.access_token);
    if (info) {
      await setCachedToken(youtubeChannelKey(accountId), JSON.stringify(info));
      return info;
    }
    channelLookupFailed.add(accountId);
    return null;
  } catch {
    channelLookupFailed.add(accountId);
    return null;
  }
}
