import { truncateAtWord } from "@/lib/automations/format";
import { describeFailure, isConnectionFailure } from "@/lib/publisher/failure";
import type { PlatformId } from "@/lib/publisher/types";

/** How much of a post's title an issue line carries before the reason starts. */
const TITLE_MAX = 48;
/** An unrecognised reason is kept, but never as a page of provider payload. */
const REASON_MAX = 150;

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  buffer: "Buffer"
};

/** A dead token in whatever words the platform used: Threads' error 190, Graph's OAuthException, Google's invalid_grant. */
const DEAD_TOKEN = /\(190\)|\berror 190\b|oauthexception|invalid_grant|token[^.]{0,40}(expired|invalid|revoked)|(expired|revoked)[^.]{0,40}token|reconnect/i;

/**
 * One plain clause for why a post or episode is stuck, from the platform's own
 * error text. An error the owner can act on says what to do in the same breath
 * (reconnect in Settings); anything not recognised is kept short rather than
 * dropped, because the raw words are still the only evidence.
 */
export function plainReason(raw: string, platform?: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  const label = platform ? (PLATFORM_LABELS[platform] ?? platform) : "The platform";
  if (/already on the channel|stopped rather than posting it a second time/i.test(text)) {
    return "already on the YouTube channel - retitle it before booking again";
  }
  if (/spam_risk|too many pending|unfinished uploads/i.test(text)) {
    return `${label} is holding too many unfinished uploads - clear its inbox in the app`;
  }
  if (/quota|uploads for today are used/i.test(text)) return `${label}'s upload limit for today is used up`;
  if (/rate limit|too many requests|throttl/i.test(text)) return `${label} asked us to slow down`;
  if (/is not on this machine|no hosted copy|ENOENT|no such file/i.test(text)) return "the video file is no longer on this machine";
  const connection =
    DEAD_TOKEN.test(text) ||
    (platform ? isConnectionFailure({ status: "failed", attempts: 0, error: text }) : false);
  if (connection) return `${label} connection expired - reconnect in Settings`;
  if (platform && platform in PLATFORM_LABELS && platform !== "threads" && platform !== "buffer") {
    const headline = describeFailure({ status: "failed", attempts: 0, error: text }, platform as PlatformId).headline;
    // describeFailure's catch-all only says "rejected" and drops the reason; keep the original words then.
    if (!/rejected this upload\.$/.test(headline)) return truncateAtWord(headline, REASON_MAX);
  }
  return truncateAtWord(text, REASON_MAX);
}

/** "<Post title (truncated)>: <plain reason>" - the shape every issue line on the Automations cards takes. */
export function issueLine(title: string, raw: string, platform?: string): string {
  const name = truncateAtWord(title, TITLE_MAX) || "Untitled post";
  return `${name}: ${plainReason(raw, platform)}`;
}
