import { createHash, randomBytes } from "node:crypto";
import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import { getCachedToken, setCachedToken } from "@/lib/publisher/tokens";

/**
 * TikTok OAuth 2.0 for the in-app "Connect TikTok" button — the same shape as
 * googleAuth.ts: the browser only ever sees TikTok's consent screen and a
 * redirect back to the Uploading Center, while the client secret and the
 * minted refresh token stay server-side in tokens.ts
 * (data/publisher-tokens.json).
 *
 * TikTok's WEB Login Kit only accepts https redirect URIs, which a localhost
 * tool cannot offer. Its DESKTOP Login Kit accepts http://localhost and
 * 127.0.0.1 instead, and requires PKCE — so the app must be registered with
 * Login Kit for Desktop and this flow always sends a code challenge. TikTok
 * hashes the verifier with SHA256 and expects it HEX encoded, not the
 * base64url that the PKCE RFC specifies.
 *
 * The verifier has to survive the round trip to TikTok and back into a
 * separate callback request, so it is parked in the same server-side cache as
 * the tokens and consumed once.
 */

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_URL = "https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url";
// video.upload puts a draft in the creator's inbox; video.publish is the
// Direct Post scope the adapter actually uses. user.info.basic is what the
// "Connected as …" badge reads.
const SCOPE = "user.info.basic,video.publish,video.upload";

export const TIKTOK_REFRESH_TOKEN_CACHE_KEY = "tiktok.refreshToken";
export const TIKTOK_CREATOR_CACHE_KEY = "tiktok.creator";
const VERIFIER_CACHE_KEY = "tiktok.codeVerifier";

export type TiktokCreatorInfo = { title: string; thumbnail: string | null };

/**
 * The redirect URI TikTok sends the browser back to. It must match the value
 * registered in the developer portal character for character, so an explicit
 * TIKTOK_REDIRECT_URI wins over the origin the request came in on (the app is
 * reachable as localhost and 127.0.0.1, only one of which may be registered).
 */
export function tiktokRedirectUri(origin: string): string {
  return process.env.TIKTOK_REDIRECT_URI?.trim() || `${origin}/api/auth/tiktok/callback`;
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("hex");
}

export async function tiktokAuthUrl(redirectUri: string): Promise<string> {
  const { tiktok } = publisherConfig();
  if (!tiktok.clientKey || !tiktok.clientSecret) {
    throw new Error(
      "Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env first (developers.tiktok.com → your app → Login Kit for Desktop, redirect URI " +
        `${redirectUri}).`
    );
  }
  const verifier = randomBytes(48).toString("hex");
  await setCachedToken(VERIFIER_CACHE_KEY, verifier);
  const params = new URLSearchParams({
    client_key: tiktok.clientKey,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri,
    state: randomBytes(12).toString("hex"),
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256"
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchanges the callback code and persists the refresh token backend-side. */
export async function exchangeTiktokCode(code: string, redirectUri: string): Promise<void> {
  const { tiktok } = publisherConfig();
  if (!tiktok.clientKey || !tiktok.clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured.");
  }
  const verifier = await getCachedToken(VERIFIER_CACHE_KEY);
  if (!verifier) {
    throw new Error("This connection attempt expired — click Connect TikTok again.");
  }
  const data = await fetchJson<{
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>(TOKEN_URL, {
    label: "TikTok OAuth code exchange",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: tiktok.clientKey,
      client_secret: tiktok.clientSecret,
      // TikTok URL-encodes the code it puts on the callback (it can end in
      // "*"), and the exchange wants it decoded.
      code: decodeURIComponent(code),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });
  if (!data.refresh_token) {
    throw new Error(
      `TikTok returned no refresh token: ${data.error ?? ""} ${data.error_description ?? ""}`.trim()
    );
  }
  await setCachedToken(TIKTOK_REFRESH_TOKEN_CACHE_KEY, data.refresh_token);
  await setCachedToken(VERIFIER_CACHE_KEY, "");
  if (data.access_token) {
    try {
      const info = await fetchCreatorInfo(data.access_token);
      if (info) await setCachedToken(TIKTOK_CREATOR_CACHE_KEY, JSON.stringify(info));
    } catch {
      // The badge falls back to plain "TikTok connected"; the connection itself succeeded.
    }
  }
}

async function fetchCreatorInfo(accessToken: string): Promise<TiktokCreatorInfo | null> {
  const data = await fetchJson<{ data?: { user?: { display_name?: string; avatar_url?: string } } }>(USER_URL, {
    label: "TikTok user lookup",
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const user = data.data?.user;
  if (!user?.display_name) return null;
  return { title: user.display_name, thumbnail: user.avatar_url ?? null };
}

/** The connected account's display name and avatar for the UI, when known. */
export async function tiktokCreatorInfo(): Promise<TiktokCreatorInfo | null> {
  const cached = await getCachedToken(TIKTOK_CREATOR_CACHE_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as TiktokCreatorInfo;
  } catch {
    return null;
  }
}
