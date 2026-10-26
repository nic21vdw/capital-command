import { publisherConfig } from "@/lib/publisher/config";

/**
 * What happens when "Sign in with ..." is pressed before the app's client id
 * and secret are saved.
 *
 * The start routes used to answer with a raw JSON 400 naming `.env`, which a
 * browser shows as a page of braces on a fresh install's most visible button.
 * The callbacks already report their outcome as a `connect_error` query that a
 * toast reads, so the start routes use the same mechanism, landing on Settings
 * because that is where the missing values are entered.
 */

export type OAuthPlatform = "youtube" | "tiktok" | "spotify" | "linkedin";

const MISSING: Record<OAuthPlatform, string> = {
  youtube: "Add the YouTube client ID and secret in Settings > Accounts first.",
  tiktok: "Add the TikTok client key and secret in Settings > Accounts first.",
  spotify: "Add the Spotify client ID and secret in Settings > Accounts first.",
  linkedin: "Add the LinkedIn client ID and secret in Settings > Accounts first."
};

export function missingCredentialsMessage(platform: OAuthPlatform): string {
  return MISSING[platform];
}

/** True when the app-level credentials the consent flow needs are not saved yet. */
export function oauthCredentialsMissing(platform: OAuthPlatform, config = publisherConfig()): boolean {
  if (platform === "youtube") return !config.youtube.clientId || !config.youtube.clientSecret;
  if (platform === "tiktok") return !config.tiktok.clientKey || !config.tiktok.clientSecret;
  if (platform === "linkedin") return !config.linkedin.clientId || !config.linkedin.clientSecret;
  return !config.spotify.clientId || !config.spotify.clientSecret;
}

/** Settings > Accounts, with the message for the toast and the row to open. */
export function connectErrorUrl(origin: string, platform: OAuthPlatform, message: string): URL {
  const target = new URL("/settings", origin);
  target.searchParams.set("connect_error", message);
  target.searchParams.set("connect", platform);
  target.hash = "accounts";
  return target;
}

/**
 * A redirect that stays on whatever origin the browser is already on.
 *
 * `request.nextUrl.origin` is NOT the address the page was opened at: Next
 * builds it from the server's configured hostname, so a page opened at
 * 127.0.0.1:3100 was sent to http://localhost:3100 on a failed sign-in - a
 * different origin, with a different localStorage (stream selection, sidebar
 * state, caches), which read as the app forgetting everything. A relative
 * `Location` is resolved by the browser against the page it is on, so it can
 * never switch origin. Use this for every in-app redirect on a sign-in route;
 * only the hop out to the provider needs an absolute URL.
 */
export function redirectWithinApp(target: URL): Response {
  return new Response(null, {
    status: 307,
    headers: { Location: `${target.pathname}${target.search}${target.hash}` }
  });
}
