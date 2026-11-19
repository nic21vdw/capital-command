import { PermanentError, fetchJson } from "@/lib/publisher/http";
import { isTiktokPrivacyLevel, type TiktokCreatorPostingInfo } from "@/lib/publisher/tiktokConsent";
import { BANNED_CODE, THROTTLE_ADVICE, THROTTLE_MINUTES, throttleCode } from "@/lib/publisher/tiktokThrottle";

const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

export class CreatorCannotPostError extends PermanentError {
  readonly retryAfterMinutes: number | null;

  constructor(readonly code: string) {
    super(
      code === BANNED_CODE
        ? "TikTok will not let this account post: it has been banned from posting."
        : `This account cannot post to TikTok right now: ${THROTTLE_ADVICE[code]} Try again later.`
    );
    this.retryAfterMinutes = THROTTLE_MINUTES[code] ?? null;
  }
}

function cannotPostCode(text: string): string | null {
  return text.includes(BANNED_CODE) ? BANNED_CODE : throttleCode(text);
}

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
  }).catch((error: unknown) => {
    const refused = error instanceof Error ? cannotPostCode(error.message) : null;
    throw refused ? new CreatorCannotPostError(refused) : error;
  });
  const code = payload.error?.code;
  if (code && code !== "ok") {
    const refused = cannotPostCode(code);
    if (refused) throw new CreatorCannotPostError(refused);
    throw new PermanentError(`TikTok creator info returned error ${code}: ${payload.error?.message ?? ""}`.trim());
  }
  const data = payload.data ?? {};
  const offered = (data.privacy_level_options ?? []).filter(isTiktokPrivacyLevel);
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
