import { waitingForConnectionHint } from "@/lib/publisher/nativeScheduling";
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

/**
 * WHY a post is blocked, for a card that offers a different first step for each.
 * `action` says which control family applies; `kind` says which one exactly:
 *
 * - `duplicate-title`  the title is already on the channel: rename, then retry
 * - `not-connected`    no account/credentials exist: CONNECT it
 * - `connection-lapsed` credentials existed and expired or were revoked: RECONNECT it
 * - `missing-media`    the file is gone: nothing helps
 * - `retryable`        anything a plain Retry may fix (abandoned upload, quota, a rejection)
 */
export type FailureKind = "duplicate-title" | "not-connected" | "connection-lapsed" | "missing-media" | "retryable";

export type FailureAdvice = {
  /** One plain sentence about what happened. */
  headline: string;
  /** The control the card should offer for it. */
  action: FailureAction;
  /** Which first step fixes it (see FailureKind). */
  kind: FailureKind;
  /**
   * True when the fix lives in Settings (every platform but YouTube, which has
   * its own Reconnect button on the card). The card links there.
   */
  viaSettings?: boolean;
  /** The provider's own words, when there are any worth keeping. */
  raw?: string;
};

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn"
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
  /**
   * Whether the leg's account has a connection NOW. A manual reminder was set
   * aside because nothing was connected at booking time; once something is,
   * "Not connected" is no longer true and the next step is Retry, not Connect.
   */
  connected?: boolean;
};

export function describeFailure(state: PlatformState, platform: PlatformId, context?: FailureContext): FailureAdvice {
  const label = PLATFORM_LABELS[platform];
  const raw = state.error?.trim() || undefined;
  const viaSettings = platform !== "youtube" || undefined;

  if (state.status === "manual") {
    const slotMs = context ? new Date(context.publishAt).getTime() : Number.NaN;
    const upcoming = Number.isFinite(slotMs) && slotMs > (context?.now ?? new Date()).getTime();
    if (context?.connected === true) {
      // The connection arrived after the booking. Retry puts it back in the queue.
      return {
        headline: upcoming
          ? `${label} wasn't connected when this was scheduled, so it was set aside as a reminder. It is connected now - Retry at slot puts it back in the queue to post at ${context.when ?? "its slot"}.`
          : `${label} wasn't connected when this was scheduled, so it never went out. It is connected now - Retry now posts it.`,
        action: "retry",
        kind: "retryable",
        raw: state.note?.trim() || raw
      };
    }
    if (upcoming) {
      return {
        // The same sentence the pending chip's hint says: one situation, one wording.
        headline: waitingForConnectionHint(platform, context?.when),
        action: "reconnect",
        kind: "not-connected",
        viaSettings,
        raw: state.note?.trim() || raw
      };
    }
    return {
      headline: `Post by hand - no ${label} account was connected by the slot${
        context?.when ? ` (${context.when})` : ""
      }, so this never went out. Post it yourself, or ${
        platform === "youtube" ? "connect YouTube and it goes out on its own." : "connect it in Settings, then press Retry."
      }`,
      action: "reconnect",
      kind: "not-connected",
      viaSettings,
      raw: state.note?.trim() || raw
    };
  }

  if (raw && DUPLICATE_TITLE.test(raw)) {
    return {
      headline: "A video with this title is already on your YouTube channel, so it wasn't posted a second time. Retitle the post, then book it again.",
      action: "none",
      kind: "duplicate-title",
      raw
    };
  }

  if (raw && NOT_SET_UP.test(raw) && !/expired or revoked/i.test(raw)) {
    return {
      headline: `${label} isn't set up for this account yet. ${
        platform === "youtube" ? "Connect it and this post goes out on its own." : "Add its connection in Settings, then press Retry."
      }`,
      action: "reconnect",
      kind: "not-connected",
      viaSettings,
      raw
    };
  }

  if (isConnectionFailure(state)) {
    return {
      headline: `The ${label} connection expired or was revoked. ${afterConnecting(platform)}`,
      action: "reconnect",
      kind: "connection-lapsed",
      viaSettings,
      raw
    };
  }

  if (raw && MISSING_MEDIA.test(raw)) {
    return {
      headline: "The video file for this post isn't on this machine any more, so it can't be uploaded.",
      action: "none",
      kind: "missing-media",
      raw
    };
  }

  if (raw && ABANDONED_UPLOAD.test(raw)) {
    return {
      headline: `${label} took the upload and then never fetched the video, so nothing was posted. Sending it again is the fix.`,
      action: "retry",
      kind: "retryable",
      raw
    };
  }

  if (raw && WORTH_RETRYING.test(raw)) {
    return { headline: `${label} couldn't take it just then — worth another go.`, action: "retry", kind: "retryable", raw };
  }

  return { headline: `${label} rejected this upload.`, action: "retry", kind: "retryable", raw };
}

/**
 * True once a duplicate-title failure has been answered by retitling the post.
 *
 * The duplicate guard's message always quotes the title it refused
 * (`channelDuplicateMessage`), so "the title in the error is no longer the
 * title on the post" is the whole proof - and it survives a reload, which a flag
 * held on the card would not. A message that quotes nothing proves nothing, so
 * it stays uncleared.
 */
export function duplicateTitleCleared(error: string | undefined, currentTitle: string): boolean {
  const quoted = error?.match(/^\s*"([^"]+)"/)?.[1];
  if (!quoted) return false;
  return quoted.trim().toLowerCase() !== currentTitle.trim().toLowerCase();
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

/**
 * An adapter's "this account has no credentials" error, wherever it turns up in
 * a longer message ("Not removed: ... could not be kept private (This YouTube
 * account is not connected. Set YOUTUBE_CLIENT_ID ...)"). The adapters write
 * these for logs: they name environment variables, which is not something a
 * toast should ever ask a person to read.
 */
const NOT_CONNECTED_ERROR =
  /\b(youtube|tiktok|instagram|facebook|linkedin)(?: account)? (?:is )?not (?:connected|configured)|\b(youtube|tiktok|instagram|facebook|linkedin) credentials are not configured/i;

/** Where a not-connected message sends people: Settings, Accounts. */
export const ACCOUNTS_SETTINGS_HREF = "/settings#accounts";

export type PlainError = {
  /** What to show. Unchanged when the message was not a not-connected error. */
  text: string;
  /** The platform that is not connected, when it was; the toast offers Settings then. */
  notConnected?: PlatformId;
};

/**
 * Turns a not-connected adapter error into the sentence a person can act on,
 * and leaves every other message alone. Applied where a message becomes user
 * visible (the Uploading Center's toasts); the long technical text stays in the
 * server's errors and logs. Pure and client-safe.
 */
export function plainError(message: string): PlainError {
  const match = NOT_CONNECTED_ERROR.exec(message);
  const name = (match?.[1] ?? match?.[2])?.toLowerCase() as PlatformId | undefined;
  if (!name) return { text: message };
  const label = PLATFORM_LABELS[name];
  return { text: `${label} isn't connected - connect it in Settings, then try again.`, notConnected: name };
}
