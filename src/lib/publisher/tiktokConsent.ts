import type { TiktokPostOptions, TiktokPrivacyLevel } from "@/lib/publisher/types";

/**
 * The consent rules shared by the browser and publisher, and the creator
 * info those rules use.
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

const DURATION_TOLERANCE_SEC = 1;

export const MUSIC_USAGE_DECLARATION = "By posting, you agree to TikTok's Music Usage Confirmation.";
export const BRANDED_CONTENT_DECLARATION =
  "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.";
export const DISCLOSURE_REQUIRED_HINT =
  "You need to indicate if your content promotes yourself, a third party, or both.";
export const BRANDED_PRIVATE_HINT = "Branded content visibility cannot be set to private.";
export const PROCESSING_NOTICE =
  "After it posts, TikTok can take a few minutes to process the video before it shows on your profile.";
export const TIKTOK_MUSIC_USAGE_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const TIKTOK_BRANDED_CONTENT_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export const TIKTOK_PRIVACY_LABELS: Record<TiktokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only you"
};

export function isTiktokPrivacyLevel(value: unknown): value is TiktokPrivacyLevel {
  return typeof value === "string" && Object.hasOwn(TIKTOK_PRIVACY_LABELS, value);
}

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

export function disclosureOn(options: TiktokPostOptions): boolean {
  return options.disclosure === true || options.brandOrganic === true || options.brandedContent === true;
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
export function consentProblem(
  options: TiktokPostOptions,
  info?: TiktokCreatorPostingInfo | null,
  clipDurationSec?: number | null
): string | null {
  if (options.delivery === "inbox") return null;
  if (!options.privacyLevel) return "Choose who can see this post.";
  if (info && info.privacyLevels.length === 0) {
    return "TikTok did not offer any audience for this account, so nothing can be posted to it.";
  }
  if (info && !info.privacyLevels.includes(options.privacyLevel)) {
    return "TikTok does not offer that audience for this account.";
  }
  if (options.brandedContent && options.privacyLevel === "SELF_ONLY") {
    return "Branded content cannot be posted privately — choose a wider audience or turn the disclosure off.";
  }
  if (info?.commentDisabled && options.allowComment) return "This account has comments turned off in TikTok.";
  if (info?.duetDisabled && options.allowDuet) return "This account has Duet turned off in TikTok.";
  if (info?.stitchDisabled && options.allowStitch) return "This account has Stitch turned off in TikTok.";
  if (info?.maxVideoSeconds && clipDurationSec && clipDurationSec > info.maxVideoSeconds + DURATION_TOLERANCE_SEC) {
    return `This clip is ${Math.round(clipDurationSec)}s long and this TikTok account can post videos up to ${info.maxVideoSeconds}s.`;
  }
  if (disclosureOn(options) && !options.brandOrganic && !options.brandedContent) return DISCLOSURE_REQUIRED_HINT;
  if (!options.consentedAt) return "Tick the box to confirm you agree to this upload before scheduling it.";
  return null;
}

export type CreatorLookup =
  | { status: "loading" }
  | { status: "ready"; info: TiktokCreatorPostingInfo }
  | { status: "error"; message: string };

export function consentBlocker(
  options: TiktokPostOptions | undefined,
  lookup: CreatorLookup,
  clipDurationSec?: number | null
): string | null {
  if (!options || options.delivery === "inbox") return null;
  if (lookup.status === "loading") return "Reading what this TikTok account allows…";
  if (lookup.status === "error") return lookup.message;
  return consentProblem(options, lookup.info, clipDurationSec);
}

export function privacyOptionHint(level: TiktokPrivacyLevel, options: TiktokPostOptions): string | null {
  return level === "SELF_ONLY" && options.brandedContent === true ? BRANDED_PRIVATE_HINT : null;
}

export function brandedContentHint(options: TiktokPostOptions): string | null {
  return options.privacyLevel === "SELF_ONLY" ? BRANDED_PRIVATE_HINT : null;
}

/**
 * The declaration TikTok requires before the publish button. The Music Usage
 * Confirmation is shown on every direct post; the Branded Content Policy joins
 * it when the post is branded content.
 */
export function complianceStatement(options: TiktokPostOptions): string {
  return options.brandedContent ? BRANDED_CONTENT_DECLARATION : MUSIC_USAGE_DECLARATION;
}

/** How TikTok labels the post once the disclosure is on. */
export function disclosureLabel(options: TiktokPostOptions): string | null {
  if (options.brandedContent) return "Paid partnership";
  if (options.brandOrganic) return "Promotional content";
  return null;
}

export function disclosureNotice(options: TiktokPostOptions): string | null {
  const label = disclosureLabel(options);
  return label ? `Your video will be labeled as '${label}'` : null;
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
  const privacyLevel = isTiktokPrivacyLevel(raw.privacyLevel) ? raw.privacyLevel : undefined;
  return {
    delivery,
    ...(privacyLevel ? { privacyLevel } : {}),
    allowComment: raw.allowComment === true,
    allowDuet: raw.allowDuet === true,
    allowStitch: raw.allowStitch === true,
    brandOrganic: raw.brandOrganic === true,
    brandedContent: raw.brandedContent === true,
    ...(raw.disclosure === true ? { disclosure: true } : {}),
    ...(typeof raw.consentedAt === "string" ? { consentedAt: raw.consentedAt } : {})
  };
}
