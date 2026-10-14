import { ThrottledError } from "@/lib/publisher/http";

/**
 * Refusals that mean "not now" rather than "not ever". TikTok returns them as
 * HTTP 400, which the shared classifier reads as a caller mistake and the
 * runner then records as a permanent failure — so a clip that TikTok would
 * have taken the next morning was being thrown away instead. Each maps to how
 * long the wall actually stands for.
 *
 * spam_risk_too_many_pending_share is the one that fires here: the inbox flow
 * leaves every clip waiting for a tap in the TikTok app, and TikTok stops
 * accepting new ones long before the creator clears the backlog.
 */
export const THROTTLE_MINUTES: Record<string, number> = {
  spam_risk_too_many_pending_share: 360,
  spam_risk_too_many_posts: 720,
  rate_limit_exceeded: 60,
  reached_active_user_cap: 60
};

export const THROTTLE_ADVICE: Record<string, string> = {
  spam_risk_too_many_pending_share:
    "TikTok is holding as many unfinished uploads as it will — open the TikTok app and post or discard the clips waiting in your inbox.",
  spam_risk_too_many_posts: "TikTok's posting limit for the day is spent.",
  rate_limit_exceeded: "TikTok is rate limiting this app.",
  reached_active_user_cap: "TikTok's daily cap for this app is spent."
};

export const BANNED_CODE = "spam_risk_user_banned_from_posting";

export function throttleCode(text: string): string | null {
  return Object.keys(THROTTLE_MINUTES).find((code) => text.includes(code)) ?? null;
}

/** A ThrottledError if the refusal was one that time clears, else null. */
export function throttleFor(text: string, label: string): ThrottledError | null {
  const code = throttleCode(text);
  if (!code) return null;
  const minutes = THROTTLE_MINUTES[code];
  const hours = minutes / 60;
  return new ThrottledError(
    minutes,
    `${label} refused: ${THROTTLE_ADVICE[code]} Trying again in ${hours} hour${hours === 1 ? "" : "s"} — the clip keeps its place.`
  );
}
