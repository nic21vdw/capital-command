/**
 * The half of the voice module the command bar's client bundle may import.
 * Nothing here touches a provider, a key or the tool executors — it is only the
 * rules for what the bar SAYS and what it remembers, so both are testable
 * without a browser.
 */

export type ShieldTone = "read-only" | "armed" | "expired";

export type ShieldView = {
  tone: ShieldTone;
  label: string;
  title: string;
};

/**
 * The bar used to say "Can act" for as long as the tab stayed open, while the
 * server-held grant quietly lapsed after an hour — every action then degraded
 * to read-only and the model reported it could not do things without saying
 * why. Expired is its own state so the lie is visible and one click fixes it.
 */
export function shieldView(input: { armed: boolean; expired: boolean }): ShieldView {
  if (input.armed) {
    return { tone: "armed", label: "Can act", title: "It can start work. Click for read-only." };
  }
  if (input.expired) {
    return {
      tone: "expired",
      label: "Arming expired",
      title: "Arming lapsed after an hour, so it is read-only again. Click to arm it."
    };
  }
  return { tone: "read-only", label: "Read-only", title: "It can look but not act. Click to let it act." };
}

/** Exactly what `describeGrant` on the server sends back. */
export type GrantView = { armed: boolean; expired: boolean; expiresAt: number | null };

export const READ_ONLY_GRANT: GrantView = { armed: false, expired: false, expiresAt: null };

export type TranscriptLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  opened?: string;
};

export type TranscriptMessage = { role: "user" | "assistant"; content: string };

export type SavedBar = {
  lines: TranscriptLine[];
  history: TranscriptMessage[];
  grantId: string | null;
};

export const BAR_STORAGE_KEY = "capital-command-bar";

/** How much of the conversation survives a reload. */
export const TRANSCRIPT_LIMIT = 20;
const HISTORY_LIMIT = 6;

const EMPTY: SavedBar = { lines: [], history: [], grantId: null };

export function packBar(state: SavedBar): string {
  return JSON.stringify({
    lines: state.lines.slice(-TRANSCRIPT_LIMIT),
    history: state.history.slice(-HISTORY_LIMIT),
    grantId: state.grantId
  });
}

function readLine(value: unknown): TranscriptLine | null {
  const line = value as Partial<TranscriptLine> | null;
  if (!line || typeof line.text !== "string") return null;
  if (line.role !== "user" && line.role !== "assistant") return null;
  return {
    id: typeof line.id === "string" && line.id ? line.id : `line-${Math.random().toString(36).slice(2)}`,
    role: line.role,
    text: line.text,
    tools: Array.isArray(line.tools) ? line.tools.filter((tool): tool is string => typeof tool === "string") : [],
    ...(typeof line.opened === "string" ? { opened: line.opened } : {})
  };
}

/**
 * An unrelated reload — the update banner restarts the app under him — used to
 * wipe the conversation. Anything unreadable comes back empty rather than
 * throwing: a bad blob must never stop the bar from rendering.
 */
export function unpackBar(raw: string | null | undefined): SavedBar {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedBar> | null;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines.map(readLine).filter((line): line is TranscriptLine => line !== null)
      : [];
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter(
          (message): message is TranscriptMessage =>
            Boolean(message) &&
            typeof (message as TranscriptMessage).content === "string" &&
            ((message as TranscriptMessage).role === "user" || (message as TranscriptMessage).role === "assistant")
        )
      : [];
    return {
      lines: lines.slice(-TRANSCRIPT_LIMIT),
      history: history.slice(-HISTORY_LIMIT),
      grantId: typeof parsed.grantId === "string" && parsed.grantId ? parsed.grantId : null
    };
  } catch {
    return EMPTY;
  }
}
