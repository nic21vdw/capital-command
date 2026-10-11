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
/* The YouTube checklist and the progress line                         */
/* ------------------------------------------------------------------ */

/** The one line above the YouTube steps: why there is a Google client to make at all. */
export const YOUTUBE_WHY =
  "YouTube asks every app to use its own Google sign-in key. You create a private one once - about 10 minutes - and posts then go out from your own channel.";

export const YOUTUBE_CONSOLE_URL = "https://console.cloud.google.com/";

/**
 * Step 1 walked through in the Google Cloud console, in the order the README
 * gives it. The consent screen is listed because Google will not issue a Web
 * application client until one is set up; External with yourself as a test
 * user is what the README asks for.
 */
export const YOUTUBE_CONSOLE_STEPS: string[] = [
  "Open the Google Cloud console and create a project, or pick one you already have.",
  "Go to APIs & Services > Library, search for YouTube Data API v3, and press Enable.",
  "Go to APIs & Services > OAuth consent screen. Choose External, give it a name and your email, and add your own Google account as a test user.",
  "Go to APIs & Services > Credentials > Create credentials > OAuth client ID, choose Web application, and under Authorized redirect URIs add the address below. Then copy the Client ID and Client secret it shows you into the fields below."
];

export type ChecklistStep = {
  id: "create-client" | "client-id" | "client-secret" | "sign-in";
  label: string;
  /** One line on how to do it. */
  detail: string;
  done: boolean;
  /** The first step not done yet, so the strip can point at it. */
  current: boolean;
};

export type YoutubeChecklist = {
  steps: ChecklistStep[];
  done: number;
  total: number;
  /** Every step is done: YouTube is signed in. */
  complete: boolean;
};

/**
 * The four things YouTube needs, in the order the README and the row walk
 * through them, with what the app can actually see. It cannot see the Google
 * console, so "create the client" is inferred: nobody has a client ID or secret
 * to paste without having made one. The ID and the secret are the row's own
 * required fields, so a renamed field renames its step. Signing in is the only
 * step a provider confirms.
 */
export function youtubeChecklist(
  state: ConnectionPresence,
  phase: { loaded: boolean; loadFailed: boolean }
): YoutubeChecklist {
  const youtube = CONNECTIONS.find((connection) => connection.id === "youtube")!;
  const [idField, secretField] = requiredFields(youtube);
  const known = phase.loaded && !phase.loadFailed;
  const hasId = known && Boolean(state.present[idField.name]);
  const hasSecret = known && Boolean(state.present[secretField.name]);
  const signedIn = known && hasId && hasSecret && Boolean(state.connected.youtube);
  const raw: Omit<ChecklistStep, "current">[] = [
    {
      id: "create-client",
      label: "Create a Google OAuth client",
      detail: "Follow the four steps in Google's console, then paste the two values it gives you.",
      done: hasId || hasSecret || signedIn
    },
    { id: "client-id", label: `Save the ${idField.label}`, detail: "Paste it into the YouTube row and press Save credentials.", done: hasId },
    { id: "client-secret", label: `Save the ${secretField.label.toLowerCase()}`, detail: "Same place, same Save credentials press.", done: hasSecret },
    { id: "sign-in", label: "Sign in with Google", detail: `Press ${youtube.oauth?.label ?? "Connect YouTube"} once both are saved and approve access.`, done: signedIn }
  ];
  const firstOpen = raw.findIndex((step) => !step.done);
  const steps = raw.map((step, index) => ({ ...step, current: index === firstOpen }));
  const done = steps.filter((step) => step.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length };
}

export type ConnectionProgress = {
  connected: number;
  /** Every row Settings lists. */
  total: number;
  /** Saved pasted tokens nothing has checked: not counted as connected. */
  savedNotVerified: number;
  /** "1 of 7 connected", plus "2 saved, not verified" when there are any. */
  line: string;
};

/** "N of M connected" across the rows the page lists, by the same status word the rows show. */
export function connectionProgress(
  state: ConnectionPresence,
  phase: { loaded: boolean; loadFailed: boolean }
): ConnectionProgress {
  const statuses = CONNECTIONS.map((connection) => connectionStatus(connection, state, phase));
  const connected = statuses.filter((status) => status === "Connected").length;
  const savedNotVerified = statuses.filter((status) => status === "Saved - not verified").length;
  const total = CONNECTIONS.length;
  const base = `${connected} of ${total} connected`;
  return {
    connected,
    total,
    savedNotVerified,
    line: savedNotVerified > 0 ? `${base} - ${savedNotVerified} saved, not verified` : base
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
  if (browser && browser.hostname === "127.0.0.1" && sent.hostname === "localhost") {
    const console = connectionId === "youtube" ? "Google Cloud console" : `${label} console`;
    return `Register this exact address in the ${console}. It says localhost even though you opened the app at 127.0.0.1 - that's expected.`;
  }
  if (browser && browser.host !== sent.host) {
    return (
      `You opened the app at ${browser.host}, but it sends ${sent.host} to ${label}. Register the address above, not one built from ${browser.host}. ` +
        `After signing in you land back on ${sent.host}.`
    );
  }
  return `Register exactly this address, character for character. It is the one the app sends to ${label}, so a different host or port fails with a redirect mismatch.`;
}
