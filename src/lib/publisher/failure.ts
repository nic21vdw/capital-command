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
  /**
   * True when the fix lives in Settings (every platform but YouTube, which has
   * its own Reconnect button on the card). The card links there.
   */
  viaSettings?: boolean;
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

/** The platform opened an upload and then never took the video. */
const ABANDONED_UPLOAD = /never fetched the video|upload expired before publishing/i;

/**
 * The duplicate guard's own refusal (duplicateGuard.ts): the title is already
 * on the channel, so the upload was stopped on purpose. Sending it again fails
 * the same way until the post is retitled.
 */
const DUPLICATE_TITLE = /already on the channel|stopped rather than posting it a second time/i;

/**
 * No credentials exist for this account at all. A reconnect-style failure for
 * the re-arm scope (connecting it fixes the post), but not an expired or revoked
 * grant: the account was never set up, so the advice is to set it up.
 */
const NOT_SET_UP = /not configured|is not connected|credentials are not configured/i;

/**
 * What to do once the connection is back. Only Google's sign-in re-queues the
 * posts that were blocked on it (api/auth/google/callback), so only YouTube
 * can promise the post goes out by itself; every other platform needs the
 * Retry button after the reconnect.
 */
function afterConnecting(platform: PlatformId): string {
  return platform === "youtube"
    ? "Reconnect and this post goes out on its own."
    : "Reconnect it in Settings, then press Retry.";
}

/**
 * Where the post is in time. Only a manual reminder reads differently before its
 * slot than after: "it never went out" is false of a post whose time has not come.
 */
export type FailureContext = {
  /** The post's go-live instant, UTC ISO-8601. */
  publishAt: string;
  /** That instant as the screen writes it ("Tue, Oct 14, 3:00 PM"); defaults to "its slot". */
  when?: string;
  now?: Date;
};

export function describeFailure(state: PlatformState, platform: PlatformId, context?: FailureContext): FailureAdvice {
  const label = PLATFORM_LABELS[platform];
  const raw = state.error?.trim() || undefined;
  const viaSettings = platform !== "youtube" || undefined;

  if (state.status === "manual") {
    const slotMs = context ? new Date(context.publishAt).getTime() : Number.NaN;
    const upcoming = Number.isFinite(slotMs) && slotMs > (context?.now ?? new Date()).getTime();
    if (upcoming) {
      return {
        headline: `Not connected - post this by hand at ${context?.when ?? "its slot"}, or connect ${label} in Settings.`,
        action: "reconnect",
        viaSettings,
        raw: state.note?.trim() || raw
      };
    }
    return {
      headline: `No ${label} account was connected when this was scheduled, so it never went out. ${
        platform === "youtube" ? "Connect one and this post goes out on its own." : "Connect it in Settings, then press Retry."
      }`,
      action: "reconnect",
      viaSettings,
      raw: state.note?.trim() || raw
    };
  }

  if (raw && DUPLICATE_TITLE.test(raw)) {
    return {
      headline: "A video with this title is already on your YouTube channel, so it wasn't posted a second time. Retitle the post, then book it again.",
      action: "none",
      raw
    };
  }

  if (raw && NOT_SET_UP.test(raw) && !/expired or revoked/i.test(raw)) {
    return {
      headline: `${label} isn't set up for this account yet. ${
        platform === "youtube" ? "Connect it and this post goes out on its own." : "Add its connection in Settings, then press Retry."
      }`,
      action: "reconnect",
      viaSettings,
      raw
    };
  }

  if (isConnectionFailure(state)) {
    return {
      headline: `The ${label} connection expired or was revoked. ${afterConnecting(platform)}`,
      action: "reconnect",
      viaSettings,
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

  if (raw && ABANDONED_UPLOAD.test(raw)) {
    return {
      headline: `${label} took the upload and then never fetched the video, so nothing was posted. Sending it again is the fix.`,
      action: "retry",
      raw
    };
  }

  if (raw && WORTH_RETRYING.test(raw)) {
    return { headline: `${label} couldn't take it just then — worth another go.`, action: "retry", raw };
  }

  return { headline: `${label} rejected this upload.`, action: "retry", raw };
}

/**
 * A leg that is not failed but is not simply waiting either: it has an error on
 * record and/or a later attempt booked (backoff after a transient failure, or a
 * throttle the platform asked us to wait out). Null for a leg with neither, so
 * a healthy pending post reads as healthy. The headline is a clause, written to
 * follow "Retrying at 3:00 PM - ".
 */
export function describeWaiting(state: PlatformState, platform: PlatformId): { headline: string; raw?: string } | null {
  if (state.status === "failed" || state.status === "manual") return null;
  if (!state.error && !state.nextAttemptAt) return null;
  const label = PLATFORM_LABELS[platform];
  const raw = state.error?.trim() || undefined;
  if (raw && /quota|uploads for today are used/i.test(raw)) {
    return { headline: `${label}'s upload limit for today is used up`, raw };
  }
  if (raw && /rate limit|too many requests|throttl|spam_risk|inbox/i.test(raw)) {
    return { headline: `${label} asked us to slow down`, raw };
  }
  if (raw && (isConnectionFailure({ ...state, status: "failed" }) || NOT_SET_UP.test(raw))) {
    return { headline: `the ${label} connection needs attention`, raw };
  }
  return { headline: `${label} couldn't take it just then`, raw };
}
