import { randomBytes } from "node:crypto";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import { getCachedToken, setCachedToken } from "@/lib/publisher/tokens";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const ME_URL = "https://api.spotify.com/v1/me";

/**
 * Nothing here can post: Spotify's write endpoints are playlists and the
 * listening library, and the show side of the API is read-only. The grant is
 * what lets the app read the account's own market and follow state, and it is
 * the account whose eyes the episode check is done through.
 */
const SCOPE = "user-read-email user-read-private user-library-read";

export const SPOTIFY_REFRESH_TOKEN_CACHE_KEY = "spotify.refreshToken";
export const SPOTIFY_PROFILE_CACHE_KEY = "spotify.profile";
const STATE_CACHE_KEY = "spotify.oauthState";

export type SpotifyProfile = {
  id: string;
  name: string;
  email: string | null;
  url: string | null;
  image: string | null;
  country: string | null;
  product: string | null;
};

export function spotifyConfigured(config = publisherConfig()): boolean {
  return Boolean(config.spotify.clientId && config.spotify.clientSecret);
}

/**
 * Spotify stopped accepting `localhost` in redirect URIs in 2025 — a loopback
 * redirect has to be the literal IP. The app is opened as localhost, so the
 * origin the consent flow starts from is rewritten rather than trusted.
 */
export function spotifyRedirectUri(origin: string): string {
  const explicit = process.env.SPOTIFY_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const url = new URL(origin);
  if (url.hostname === "localhost" || url.hostname === "[::1]") url.hostname = "127.0.0.1";
  return `${url.origin}/api/auth/spotify/callback`;
}

function credentials() {
  const { spotify } = publisherConfig();
  if (!spotify.clientId || !spotify.clientSecret) {
    throw new Error(
      "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first (developer.spotify.com/dashboard → your app → Settings)."
    );
  }
  return { clientId: spotify.clientId, clientSecret: spotify.clientSecret };
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function spotifyAuthUrl(redirectUri: string): Promise<string> {
  const { clientId } = credentials();
  const state = randomBytes(16).toString("hex");
  await setCachedToken(STATE_CACHE_KEY, state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPE,
    state
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeSpotifyCode(code: string, state: string, redirectUri: string): Promise<void> {
  const { clientId, clientSecret } = credentials();
  const expected = await getCachedToken(STATE_CACHE_KEY);
  if (!expected || expected !== state) {
    throw new Error("This connection attempt expired — click Connect Spotify again.");
  }
  const data = await fetchJson<{ access_token?: string; refresh_token?: string; error_description?: string }>(TOKEN_URL, {
    label: "Spotify OAuth code exchange",
    headers: { Authorization: basicAuth(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
  });
  if (!data.refresh_token) {
    throw new Error(`Spotify returned no refresh token: ${data.error_description ?? "unknown reason"}`);
  }
  await setCachedToken(SPOTIFY_REFRESH_TOKEN_CACHE_KEY, data.refresh_token);
  await setCachedToken(STATE_CACHE_KEY, "");
  if (data.access_token) {
    const profile = await fetchProfile(data.access_token).catch(() => null);
    if (profile) await setCachedToken(SPOTIFY_PROFILE_CACHE_KEY, JSON.stringify(profile));
  }
}

export async function disconnectSpotify(): Promise<void> {
  await setCachedToken(SPOTIFY_REFRESH_TOKEN_CACHE_KEY, "");
  await setCachedToken(SPOTIFY_PROFILE_CACHE_KEY, "");
}

export async function spotifyConnected(): Promise<boolean> {
  return Boolean(await getCachedToken(SPOTIFY_REFRESH_TOKEN_CACHE_KEY));
}

/**
 * A user access token, or null when nobody has connected an account. Spotify
 * rotates the refresh token on some grants and omits it on others, so a new
 * one is only written when it actually differs.
 */
export async function spotifyUserToken(): Promise<string | null> {
  const refreshToken = await getCachedToken(SPOTIFY_REFRESH_TOKEN_CACHE_KEY);
  if (!refreshToken || !spotifyConfigured()) return null;
  const { clientId, clientSecret } = credentials();
  const data = await fetchJson<{ access_token?: string; refresh_token?: string }>(TOKEN_URL, {
    label: "Spotify token refresh",
    headers: { Authorization: basicAuth(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  });
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await setCachedToken(SPOTIFY_REFRESH_TOKEN_CACHE_KEY, data.refresh_token);
  }
  return data.access_token ?? null;
}

/**
 * The app's own token, for the reads that need no account. It is what keeps
 * the show check working on the day the 180-day refresh token lapses.
 */
export async function spotifyAppToken(): Promise<string | null> {
  if (!spotifyConfigured()) return null;
  const { clientId, clientSecret } = credentials();
  const data = await fetchJson<{ access_token?: string }>(TOKEN_URL, {
    label: "Spotify app token",
    headers: { Authorization: basicAuth(clientId, clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });
  return data.access_token ?? null;
}

async function fetchProfile(accessToken: string): Promise<SpotifyProfile> {
  const me = await fetchJson<{
    id: string;
    display_name?: string | null;
    email?: string | null;
    country?: string | null;
    product?: string | null;
    external_urls?: { spotify?: string };
    images?: { url: string }[];
  }>(ME_URL, { label: "Spotify profile", method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  return {
    id: me.id,
    name: me.display_name || me.id,
    email: me.email ?? null,
    url: me.external_urls?.spotify ?? null,
    image: me.images?.[0]?.url ?? null,
    country: me.country ?? null,
    product: me.product ?? null
  };
}

export async function spotifyProfile(): Promise<SpotifyProfile | null> {
  const cached = await getCachedToken(SPOTIFY_PROFILE_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as SpotifyProfile;
    } catch {
      // Fall through and ask Spotify again.
    }
  }
  const token = await spotifyUserToken().catch(() => null);
  if (!token) return null;
  const profile = await fetchProfile(token).catch(() => null);
  if (profile) await setCachedToken(SPOTIFY_PROFILE_CACHE_KEY, JSON.stringify(profile));
  return profile;
}
