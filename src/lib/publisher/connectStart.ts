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

export type OAuthPlatform = "youtube" | "tiktok" | "spotify";

const MISSING: Record<OAuthPlatform, string> = {
  youtube: "Add the YouTube client ID and secret in Settings > Accounts first.",
  tiktok: "Add the TikTok client key and secret in Settings > Accounts first.",
  spotify: "Add the Spotify client ID and secret in Settings > Accounts first."
};

export function missingCredentialsMessage(platform: OAuthPlatform): string {
  return MISSING[platform];
}

/** True when the app-level credentials the consent flow needs are not saved yet. */
export function oauthCredentialsMissing(platform: OAuthPlatform, config = publisherConfig()): boolean {
  if (platform === "youtube") return !config.youtube.clientId || !config.youtube.clientSecret;
  if (platform === "tiktok") return !config.tiktok.clientKey || !config.tiktok.clientSecret;
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
