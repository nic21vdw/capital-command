import type { PlatformId, PlatformState } from "@/lib/publisher/types";

/**
 * What a blocked post says on the board, and what a reconnect may revive.
 *
 * A platform's raw error is a provider payload — a page of Google JSON for one
 * dead token — and a card that shows it tells you nothing you can act on. This
 * turns a blocked state into one sentence and the one action that fixes it,
 * pure so both halves are tested here rather than eyeballed in the UI. The raw
 * text stays available; it just stops being the headline.
 *
 * Nothing here may import anything with a server-side dependency: the schedule
 * board is a client component, so this module ends up in the browser bundle.
 * That is also why `isConnectionFailure` lives here rather than in rearm.ts —
 * the board and the re-arm scope have to agree on what a reconnect fixes.
 */

/**
 * Failure reasons a fresh connection actually fixes. Anything else — a video
 * the platform rejected, a file that isn't on this machine — is still just as
 * failed after a reconnect.
 */
const CONNECTION_FAILURE =
  /reconnect|invalid_grant|expired or revoked|is not connected|not configured|scope|unauthoriz|unauthentic|\b401\b/i;

/** True when this platform is blocked on a connection rather than on the post. */
export function isConnectionFailure(state: PlatformState): boolean {
  // "manual" means nothing was connected when the post was scheduled, so it is
  // blocked on the connection by definition and carries no error to read.
  if (state.status === "manual") return true;
  return Boolean(state.error && CONNECTION_FAILURE.test(state.error));
}

export type FailureAction = "reconnect" | "retry" | "none";

export type FailureAdvice = {
  /** One plain sentence about what happened. */
  headline: string;
  /** The control the card should offer for it. */
  action: FailureAction;
  /** The provider's own words, when there are any worth keeping. */
  raw?: string;
};

const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

/** The file is gone, so nothing on the platform side can help. */
const MISSING_MEDIA = /is not on this machine|no hosted copy|ENOENT|no such file/i;

/** Worth trying again later without touching anything. */
const WORTH_RETRYING = /quota|rate limit|too many requests|timed out|timeout|temporarily|\b5\d\d\b/i;

export function describeFailure(state: PlatformState, platform: PlatformId): FailureAdvice {
  const label = PLATFORM_LABELS[platform];
  const raw = state.error?.trim() || undefined;

  if (state.status === "manual") {
    return {
      headline: `No ${label} account was connected when this was scheduled, so it never went out.`,
      action: "reconnect",
      raw: state.note?.trim() || raw
    };
  }

  if (isConnectionFailure(state)) {
    return {
      headline: `The ${label} connection expired or was revoked. Reconnect and this post goes out on its own.`,
      action: "reconnect",
      raw
    };
  }

  if (raw && MISSING_MEDIA.test(raw)) {
    return {
      headline: "The video file for this post isn't on this machine any more, so it can't be uploaded.",
      action: "none",
      raw
    };
  }

  if (raw && WORTH_RETRYING.test(raw)) {
    return { headline: `${label} couldn't take it just then — worth another go.`, action: "retry", raw };
  }

  return { headline: `${label} rejected this upload.`, action: "retry", raw };
}
