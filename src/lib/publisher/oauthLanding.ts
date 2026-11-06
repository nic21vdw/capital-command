/**
 * What the app says when a sign-in sends the browser back to it.
 *
 * The OAuth callbacks land on a screen with `?connected=<platform>` or
 * `?connect_error=<code>&connect=<platform>`. That used to be a toast fired
 * from an effect on first render, which ran before the toaster had mounted and
 * so said nothing at all. This is the same result as plain data, so the page
 * can also put it in the layout (where it cannot be missed) and the toast can
 * be a courtesy on top. Pure and client-safe.
 */

import { CONNECTIONS } from "./connections";
import { connectErrorMessage } from "./connectErrors";

export type OAuthLanding = {
  tone: "success" | "error";
  platform: string | null;
  /** One short line: what happened. */
  title: string;
  /** What to do next, or what changes now. */
  detail: string;
  /** The raw provider code on a failure, kept for anyone who wants to search it. */
  raw?: string;
};

function labelOf(platform: string | null): string {
  return CONNECTIONS.find((connection) => connection.id === platform)?.label ?? "Account";
}

const KNOWN = new Set(CONNECTIONS.map((connection) => connection.id));

/** The landing a set of query params describes, or null when the page was opened normally. */
export function describeOAuthLanding(params: URLSearchParams): OAuthLanding | null {
  const connected = params.get("connected");
  if (connected) {
    const platform = KNOWN.has(connected) ? connected : null;
    const label = platform ? labelOf(platform) : "Account";
    const recovered = Number(params.get("recovered") ?? 0);
    if (platform === "youtube" && recovered > 0) {
      return {
        tone: "success",
        platform,
        title: "YouTube reconnected",
        detail: `${recovered} blocked upload${recovered === 1 ? "" : "s"} retried automatically.`
      };
    }
    const detail =
      platform === "youtube"
        ? "Scheduled posts will upload automatically."
        : platform === "tiktok"
          ? params.get("audited") === "1"
            ? "Scheduled posts will publish automatically."
            : "Clips land in your TikTok inbox to finish in the app."
          : platform === "spotify"
            ? "This page can now check which episodes Spotify has pulled in."
            : platform === "linkedin"
              ? "Scheduled LinkedIn posts will publish automatically. Choose below whether they come from your profile or a company page."
              : "You can post to it from here now.";
    return { tone: "success", platform, title: `${label} connected`, detail };
  }

  const raw = params.get("connect_error");
  if (raw) {
    const requested = params.get("connect");
    const platform = requested && KNOWN.has(requested) ? requested : null;
    return {
      tone: "error",
      platform,
      title: platform ? `${labelOf(platform)} did not connect` : "Sign-in did not finish",
      detail: connectErrorMessage(raw, platform),
      raw
    };
  }
  return null;
}

/** The query keys a landing uses, so they can be removed from the address afterwards. */
export const OAUTH_LANDING_PARAMS = ["connected", "connect_error", "connect", "audited", "recovered", "account"] as const;
