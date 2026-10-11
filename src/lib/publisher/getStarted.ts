/**
 * The "Get started" strip at the top of Settings > Accounts, and the status
 * words every account row uses.
 *
 * A new install met seven collapsed rows with equal weight and no hint which
 * one to open first, and a pasted-token platform (Instagram, Facebook, Threads)
 * can never prove it works from here. This puts the answer in one place, as
 * data, so the strip and the rows cannot disagree about what "connected" means:
 * only a browser sign-in connects, and only YouTube is the recommended first.
 */

import { CONNECTIONS, type Connection } from "./connections";

export type ConnectionPresence = {
  present: Record<string, boolean>;
  connected: Record<string, boolean>;
};

export type ConnectionStatus =
  | "Checking"
  | "Unavailable"
  | "Connected"
  | "Sign in needed"
  | "Saved - not verified"
  | "Finish setup"
  | "Not set up";

export function requiredFields(connection: Connection) {
  return connection.fields.filter((field) => !field.optional);
}

export function credentialsReady(connection: Connection, present: Record<string, boolean>): boolean {
  return requiredFields(connection).every((field) => present[field.name]);
}

/** The one status word for a platform. Rows and the strip both read this. */
export function connectionStatus(
  connection: Connection,
  state: ConnectionPresence,
  phase: { loaded: boolean; loadFailed: boolean }
): ConnectionStatus {
  if (!phase.loaded) return "Checking";
  if (phase.loadFailed) return "Unavailable";
  const ready = credentialsReady(connection, state.present);
  if (ready && state.connected[connection.id]) return "Connected";
  if (ready) return connection.oauth ? "Sign in needed" : "Saved - not verified";
  return connection.fields.some((field) => state.present[field.name]) ? "Finish setup" : "Not set up";
}

export const YOUTUBE_RECOMMENDATION =
  "Start with YouTube: it schedules natively and powers the mirror to Instagram and Facebook.";

/** What to do next on one platform, in one line. */
export function nextStep(connection: Connection, status: ConnectionStatus, state: ConnectionPresence): string {
  if (status === "Checking") return "Checking what is saved...";
  if (status === "Unavailable") return "Could not read what is saved. Reload the page.";
  if (status === "Connected") return "Done. Reconnect only if it stops posting.";
  if (status === "Sign in needed") return `Credentials saved. Press ${connection.oauth?.label ?? "sign in"} to finish.`;
  if (status === "Saved - not verified") {
    return connection.id === "media-hosting"
      ? "Saved. It is first used when an Instagram or Facebook post goes out."
      : "Saved. Nothing can check it until a post goes out.";
  }
  if (status === "Finish setup") {
    const missing = requiredFields(connection)
      .filter((field) => !state.present[field.name])
      .map((field) => field.label.toLowerCase());
    return `Still missing: ${missing.join(", ")}.`;
  }
  switch (connection.id) {
    case "youtube":
      return "Create a Google OAuth client, paste its ID and secret, then sign in.";
    case "tiktok":
      return "Create a TikTok app, paste its client key and secret, then sign in.";
    case "spotify":
      return "Optional: paste your client ID and secret to check podcast episodes.";
    case "instagram":
    case "facebook":
      return "Needs a one-time developer step - open for the steps.";
    case "threads":
      return "Paste a long-lived Threads access token.";
    case "media-hosting":
      return "Needed for Instagram and Facebook video: add a storage bucket.";
    default:
      return "Add the credentials for this account.";
  }
}

export type GetStartedItem = {
  id: string;
  label: string;
  status: ConnectionStatus;
  step: string;
  connected: boolean;
  /** YouTube, until it is connected. */
  recommended: boolean;
};

export type GetStarted = {
  items: GetStartedItem[];
  /** At least one platform finished a sign-in. */
  setUp: boolean;
  connectedLabels: string[];
  /** The one-line advice above the strip, or null once there is nothing to advise. */
  headline: string;
};

/** YouTube first, then the rest in the order Settings lists them. */
export function buildGetStarted(
  state: ConnectionPresence,
  phase: { loaded: boolean; loadFailed: boolean }
): GetStarted {
  const ordered = [...CONNECTIONS].sort((a, b) => Number(b.id === "youtube") - Number(a.id === "youtube"));
  const items = ordered.map((connection): GetStartedItem => {
    const status = connectionStatus(connection, state, phase);
    return {
      id: connection.id,
      label: connection.label,
      status,
      step: nextStep(connection, status, state),
      connected: status === "Connected",
      recommended: connection.id === "youtube" && status !== "Connected"
    };
  });
  const connectedLabels = items.filter((item) => item.connected).map((item) => item.label);
  const setUp = connectedLabels.length > 0;
  return {
    items,
    setUp,
    connectedLabels,
    headline: setUp
      ? `You're set up: ${connectedLabels.join(" and ")} ${connectedLabels.length === 1 ? "is" : "are"} connected. Add anything else below, when you want it.`
      : YOUTUBE_RECOMMENDATION
  };
}

/* ------------------------------------------------------------------ */
/* The redirect address                                                */
/* ------------------------------------------------------------------ */

/**
 * The line under a redirect URI. The address shown is the one the app SENDS to
 * the provider: the server builds it from its own configured host, not from the
 * address bar, so a page opened at 127.0.0.1 still sends localhost. What the
 * person registers must match what is sent, so that is what this says, and when
 * the address bar differs it says so before the provider's own error page does.
 */
export function redirectUriNote(connectionId: string, uri: string, browserOrigin: string | null): string | null {
  if (connectionId === "spotify") return null; // `redirectNote` on the connection already covers it.
  let sent: URL;
  try {
    sent = new URL(uri);
  } catch {
    return null;
  }
  const label = CONNECTIONS.find((connection) => connection.id === connectionId)?.label ?? "the provider";
  let browser: URL | null = null;
  try {
    browser = browserOrigin ? new URL(browserOrigin) : null;
  } catch {
    browser = null;
  }
  if (browser && browser.host !== sent.host) {
    return (
      `You opened the app at ${browser.host}, but it sends ${sent.host} to ${label}. Register the address above, not one built from ${browser.host}. ` +
        `After signing in you land back on ${sent.host}.`
    );
  }
  return `Register exactly this address, character for character. It is the one the app sends to ${label}, so a different host or port fails with a redirect mismatch.`;
}
