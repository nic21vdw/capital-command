/**
 * What a failed sign-in says, in words a person can act on.
 *
 * The providers report a failure as a code on a redirect back to the app
 * ("access_denied", "redirect_uri_mismatch") or as the raw body of a failed
 * token exchange, and the app used to put that string in a four-second toast.
 * Nobody who has never opened a Google Cloud console knows what
 * `redirect_uri_mismatch` wants from them, and the toast was gone before they
 * could look it up. `explainConnectError` turns the common ones into a plain
 * sentence plus the fix; anything it does not know is passed through untouched
 * rather than guessed at.
 *
 * `rememberConnectFailure` keeps the last failure per platform in this browser
 * so Settings > Accounts can show it in the platform's row until it is dismissed
 * or a later sign-in works. Pure and client-safe: no server imports, and every
 * storage access is guarded because it can throw in a private window.
 */

import { CONNECTIONS } from "./connections";

export type ConnectErrorKind =
  | "denied"
  | "redirect-mismatch"
  | "bad-client"
  | "bad-grant"
  | "no-refresh-token"
  | "missing-credentials"
  | "expired"
  | "unknown";

export type ConnectErrorExplanation = {
  kind: ConnectErrorKind;
  /** What happened, one sentence. */
  summary: string;
  /** What to do about it, one sentence. */
  fix: string;
  /** The provider's own code or message, kept for the person who wants to search it. */
  raw: string;
};

function labelOf(platform?: string | null): string {
  return CONNECTIONS.find((connection) => connection.id === platform)?.label ?? "the provider";
}

/** Plain English for one failed sign-in. `platform` is a connection id, when known. */
export function explainConnectError(raw: string, platform?: string | null): ConnectErrorExplanation {
  const text = (raw ?? "").trim();
  const lower = text.toLowerCase();
  const label = labelOf(platform);
  const make = (kind: ConnectErrorKind, summary: string, fix: string): ConnectErrorExplanation => ({
    kind,
    summary,
    fix,
    raw: text
  });

  // Our own start routes name Settings already; recognise them first so the
  // provider-code checks below cannot misread their wording.
  if (lower.includes("in settings > accounts first") || lower.includes("are not configured")) {
    return make(
      "missing-credentials",
      `${label} cannot start sign-in yet: its app credentials are not saved.`,
      `Paste the ${label} client ID and secret into the ${label} row below, save them, then sign in.`
    );
  }
  if (lower.includes("denied") || (platform === "linkedin" && lower.includes("cancel"))) {
    // Only the providers that actually gate a new app say why it was refused.
    const gate =
      platform === "youtube"
        ? " If Google says the app is unverified, choose Advanced, then continue, and make sure your own account is listed as a test user."
        : platform === "tiktok"
          ? " If TikTok says the app is in sandbox mode, add your account as a test user in the TikTok developer portal."
          : "";
    return make(
      "denied",
      `The ${label} sign-in was cancelled, or access was not granted.`,
      `Try again and approve every permission ${label} asks for.${gate}`
    );
  }
  if (lower.includes("redirect_uri_mismatch") || lower.includes("redirect uri") || lower.includes("redirect_uri")) {
    return make(
      "redirect-mismatch",
      `${label} rejected the sign-in: the redirect address does not match the one registered.`,
      `Copy the redirect URI shown in the ${label} row and add it, exactly as written, to your ${label} app's allowed redirect URIs. Save there, wait a minute, then try again.`
    );
  }
  if (lower.includes("invalid_client") || lower.includes("unauthorized_client")) {
    return make(
      "bad-client",
      `${label} did not recognise the client ID or secret saved here.`,
      `Re-copy both values from your ${label} app (no spaces, the secret not the ID twice), save them in the ${label} row, then sign in again.`
    );
  }
  if (lower.includes("invalid_grant")) {
    return make(
      "bad-grant",
      `${label} refused the sign-in code. It was already used, or it expired.`,
      `Press the ${label} sign-in button once more and finish it without refreshing the page.`
    );
  }
  if (lower.includes("no refresh token")) {
    return make(
      "no-refresh-token",
      `${label} signed you in but did not hand back a long-lived token.`,
      platform === "youtube"
        ? "Remove this app at myaccount.google.com/permissions, then sign in again."
        : `Remove this app's access in your ${label} account settings, then sign in again.`
    );
  }
  if (lower.includes("expired") || lower.includes("no authorization code")) {
    return make(
      "expired",
      `The ${label} sign-in did not finish.`,
      `Press the ${label} sign-in button again and complete it in one go.`
    );
  }
  return make(
    "unknown",
    `The ${label} sign-in failed.`,
    text ? `${label} said: ${text}` : "Try again; if it keeps failing, check the credentials in this row."
  );
}

/** The explanation as one string, for a toast. */
export function connectErrorMessage(raw: string, platform?: string | null): string {
  const { summary, fix } = explainConnectError(raw, platform);
  return `${summary} ${fix}`;
}

/* ------------------------------------------------------------------ */
/* Remembering the failure                                             */
/* ------------------------------------------------------------------ */

export const CONNECT_FAILURE_KEY = "colateral:connect-failures";

export type ConnectFailures = Record<string, { raw: string; at: string }>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readConnectFailures(storage: StorageLike | null = browserStorage()): ConnectFailures {
  try {
    const parsed = JSON.parse(storage?.getItem(CONNECT_FAILURE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const failures: ConnectFailures = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const value = entry as { raw?: unknown; at?: unknown } | null;
      if (CONNECTIONS.some((connection) => connection.id === id) && typeof value?.raw === "string") {
        failures[id] = { raw: value.raw, at: typeof value.at === "string" ? value.at : "" };
      }
    }
    return failures;
  } catch {
    return {};
  }
}

function writeConnectFailures(failures: ConnectFailures, storage: StorageLike | null): ConnectFailures {
  try {
    storage?.setItem(CONNECT_FAILURE_KEY, JSON.stringify(failures));
  } catch {
    // The inline note is a convenience; the toast already said it.
  }
  return failures;
}

/** Keep this platform's latest failure until it is dismissed or a sign-in works. */
export function rememberConnectFailure(
  platform: string,
  raw: string,
  storage: StorageLike | null = browserStorage(),
  now: Date = new Date()
): ConnectFailures {
  return writeConnectFailures(
    { ...readConnectFailures(storage), [platform]: { raw, at: now.toISOString() } },
    storage
  );
}

/** Dismissed, or superseded by a success. Safe to call when nothing is stored. */
export function clearConnectFailure(platform: string, storage: StorageLike | null = browserStorage()): ConnectFailures {
  const current = readConnectFailures(storage);
  if (!(platform in current)) return current;
  const next = { ...current };
  delete next[platform];
  return writeConnectFailures(next, storage);
}
