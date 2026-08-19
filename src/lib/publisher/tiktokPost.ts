import { fetchJson } from "@/lib/publisher/http";
import type { TiktokPostOptions, TiktokPrivacyLevel } from "@/lib/publisher/types";

/**
 * The consent a creator gives before a clip is direct posted to TikTok, and
 * the creator_info query the choices are drawn from.
 *
 * TikTok's content sharing guidelines do not treat these as preferences. A
 * direct post is only allowed when the creator picked the privacy level with
 * nothing preselected, turned each interaction on themselves, and answered the
 * commercial-content question — and the options offered have to be the ones
 * creator_info returned for that account, not a fixed list. So the answers are
 * captured at scheduling time, travel with the queue item, and are what the
 * adapter sends hours later when the slot arrives.
 *
 * The inbox flow needs none of this: the clip lands as a draft and the creator
 * makes every one of these choices inside TikTok before it posts. That is why
 * an unaudited app is allowed to use it at all.
 */

const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

export const TIKTOK_PRIVACY_LABELS: Record<TiktokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only you"
};

const PRIVACY_LEVELS = Object.keys(TIKTOK_PRIVACY_LABELS) as TiktokPrivacyLevel[];

export type TiktokCreatorPostingInfo = {
  nickname: string | null;
  handle: string | null;
  avatarUrl: string | null;
  /** Exactly the levels this account may post at, in TikTok's own order. */
  privacyLevels: TiktokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoSeconds: number | null;
};

type CreatorInfoResponse = {
  data?: {
    creator_nickname?: string;
    creator_username?: string;
    creator_avatar_url?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  };
  error?: { code?: string; message?: string };
};

/**
 * What this creator is allowed to choose. Called before the panel is drawn and
 * again before every direct post — an account that turned Duet off since the
 * clip was scheduled must not have it turned back on by a stale answer.
 */
export async function fetchCreatorPostingInfo(accessToken: string): Promise<TiktokCreatorPostingInfo> {
  const payload = await fetchJson<CreatorInfoResponse>(CREATOR_INFO_URL, {
    label: "TikTok creator info",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" }
  });
  const data = payload.data ?? {};
  const offered = (data.privacy_level_options ?? []).filter((level): level is TiktokPrivacyLevel =>
    PRIVACY_LEVELS.includes(level as TiktokPrivacyLevel)
  );
  return {
    nickname: data.creator_nickname ?? null,
    handle: data.creator_username ?? null,
    avatarUrl: data.creator_avatar_url ?? null,
    privacyLevels: offered,
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoSeconds: typeof data.max_video_post_duration_sec === "number" ? data.max_video_post_duration_sec : null
  };
}

/** The consent a freshly opened panel starts from: nothing chosen, nothing on. */
export function emptyConsent(): TiktokPostOptions {
  return {
    delivery: "direct",
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    brandOrganic: false,
    brandedContent: false
  };
}

/**
 * Why this consent cannot be posted, or null when it can. Shown under the
 * panel and enforced again server-side — the rules are TikTok's, so the UI is
 * not allowed to be the only place they hold.
 */
export function consentProblem(options: TiktokPostOptions, info?: TiktokCreatorPostingInfo | null): string | null {
  if (options.delivery === "inbox") return null;
  if (!options.privacyLevel) return "Choose who can see this post.";
  if (info && info.privacyLevels.length > 0 && !info.privacyLevels.includes(options.privacyLevel)) {
    return "TikTok does not offer that audience for this account.";
  }
  if (options.brandedContent && options.privacyLevel === "SELF_ONLY") {
    return "Branded content cannot be posted privately — choose a wider audience or turn the disclosure off.";
  }
  if (info?.commentDisabled && options.allowComment) return "This account has comments turned off in TikTok.";
  if (info?.duetDisabled && options.allowDuet) return "This account has Duet turned off in TikTok.";
  if (info?.stitchDisabled && options.allowStitch) return "This account has Stitch turned off in TikTok.";
  return null;
}

/**
 * The declaration TikTok requires under the disclosure, worded by what was
 * disclosed. Empty when nothing was.
 */
export function complianceStatement(options: TiktokPostOptions): string | null {
  if (options.brandedContent) {
    return "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.";
  }
  if (options.brandOrganic) return "By posting, you agree to TikTok's Music Usage Confirmation.";
  return null;
}

/** How TikTok labels the post once the disclosure is on. */
export function disclosureLabel(options: TiktokPostOptions): string | null {
  if (options.brandedContent) return "Paid partnership";
  if (options.brandOrganic) return "Promotional content";
  return null;
}

/**
 * Narrows a stored consent to what the creator's CURRENT TikTok settings
 * allow. A queued post carries answers given hours or days ago; an interaction
 * the creator has since switched off in TikTok must not be sent as on.
 */
export function reconcileWithCreator(
  options: TiktokPostOptions,
  info: TiktokCreatorPostingInfo
): TiktokPostOptions {
  return {
    ...options,
    allowComment: options.allowComment === true && !info.commentDisabled,
    allowDuet: options.allowDuet === true && !info.duetDisabled,
    allowStitch: options.allowStitch === true && !info.stitchDisabled
  };
}

/** Parses consent off an API request body, keeping only known shapes. */
export function parseConsent(input: unknown): TiktokPostOptions | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const delivery = raw.delivery === "inbox" ? "inbox" : "direct";
  const privacyLevel = PRIVACY_LEVELS.find((level) => level === raw.privacyLevel);
  return {
    delivery,
    ...(privacyLevel ? { privacyLevel } : {}),
    allowComment: raw.allowComment === true,
    allowDuet: raw.allowDuet === true,
    allowStitch: raw.allowStitch === true,
    brandOrganic: raw.brandOrganic === true,
    brandedContent: raw.brandedContent === true,
    ...(typeof raw.consentedAt === "string" ? { consentedAt: raw.consentedAt } : {})
  };
}
