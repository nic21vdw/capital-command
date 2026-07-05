import { publisherConfig } from "@/lib/publisher/config";
import { fetchJson } from "@/lib/publisher/http";
import { setCachedToken } from "@/lib/publisher/tokens";

/**
 * Google OAuth 2.0 for the in-app "Connect YouTube" button. The whole flow
 * stays on the backend: the browser only ever sees Google's consent screen
 * and a redirect back to the Uploading Center. The client secret comes from
 * .env and the refresh token is persisted via tokens.ts
 * (data/publisher-tokens.json) — nothing sensitive reaches the front end,
 * localStorage, or a URL. This tool runs on localhost only, which is why the
 * redirect URI is derived from the local request origin.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export const YOUTUBE_REFRESH_TOKEN_CACHE_KEY = "youtube.refreshToken";

export function googleAuthUrl(redirectUri: string): string {
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
    prompt: "consent"
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchanges the callback code and persists the refresh token backend-side. */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<void> {
  const { youtube } = publisherConfig();
  if (!youtube.clientId || !youtube.clientSecret) {
    throw new Error("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not configured.");
  }
  const data = await fetchJson<{ refresh_token?: string }>(TOKEN_URL, {
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
  await setCachedToken(YOUTUBE_REFRESH_TOKEN_CACHE_KEY, data.refresh_token);
}
