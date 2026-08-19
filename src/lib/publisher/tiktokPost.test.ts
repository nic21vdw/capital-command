import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";
import {
  complianceStatement,
  consentProblem,
  emptyConsent,
  fetchCreatorPostingInfo,
  parseConsent,
  reconcileWithCreator,
  type TiktokCreatorPostingInfo
} from "@/lib/publisher/tiktokPost";

/**
 * TikTok's posting rules, held where they are decided. The panel and the
 * adapter both ask these questions — the point of testing them here is that
 * neither is allowed to be the only place an answer is enforced.
 */

const CREATOR: TiktokCreatorPostingInfo = {
  nickname: "Nic",
  handle: "nicvandewetering",
  avatarUrl: null,
  privacyLevels: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoSeconds: 600
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tiktok consent", () => {
  it("starts with nothing chosen and nothing turned on", () => {
    const fresh = emptyConsent();

    expect(fresh.privacyLevel).toBeUndefined();
    expect(fresh.allowComment).toBe(false);
    expect(fresh.allowDuet).toBe(false);
    expect(fresh.allowStitch).toBe(false);
    expect(fresh.brandOrganic).toBe(false);
    expect(fresh.brandedContent).toBe(false);
  });

  it("refuses a direct post until the creator picks an audience", () => {
    expect(consentProblem(emptyConsent(), CREATOR)).toMatch(/who can see/i);
    expect(consentProblem({ ...emptyConsent(), privacyLevel: "SELF_ONLY" }, CREATOR)).toBeNull();
  });

  it("asks nothing of a post going to the inbox", () => {
    expect(consentProblem({ delivery: "inbox" }, CREATOR)).toBeNull();
  });

  it("refuses an audience this account is not offered", () => {
    const consent = { ...emptyConsent(), privacyLevel: "FOLLOWER_OF_CREATOR" as const };

    expect(consentProblem(consent, CREATOR)).toMatch(/does not offer/i);
  });

  it("refuses branded content posted privately", () => {
    const consent = { ...emptyConsent(), privacyLevel: "SELF_ONLY" as const, brandedContent: true };

    expect(consentProblem(consent, CREATOR)).toMatch(/cannot be posted privately/i);
  });

  it("refuses an interaction the creator has turned off in TikTok", () => {
    const consent = { ...emptyConsent(), privacyLevel: "SELF_ONLY" as const, allowDuet: true };

    expect(consentProblem(consent, CREATOR)).toMatch(/duet/i);
  });

  it("names the policy the disclosure commits to", () => {
    expect(complianceStatement(emptyConsent())).toBeNull();
    expect(complianceStatement({ ...emptyConsent(), brandOrganic: true })).toBe(
      "By posting, you agree to TikTok's Music Usage Confirmation."
    );
    expect(complianceStatement({ ...emptyConsent(), brandedContent: true })).toMatch(/Branded Content Policy/);
  });

  it("drops an answer the creator's settings no longer allow", () => {
    const stale = { ...emptyConsent(), privacyLevel: "SELF_ONLY" as const, allowDuet: true, allowComment: true };

    const reconciled = reconcileWithCreator(stale, CREATOR);

    expect(reconciled.allowDuet).toBe(false);
    expect(reconciled.allowComment).toBe(true);
    expect(consentProblem(reconciled, CREATOR)).toBeNull();
  });

  it("reads only known values off a request body", () => {
    const parsed = parseConsent({
      delivery: "direct",
      privacyLevel: "EVERYONE_INCLUDING_STRANGERS",
      allowComment: "yes",
      allowStitch: true,
      nonsense: 1
    });

    expect(parsed).toEqual({
      delivery: "direct",
      allowComment: false,
      allowDuet: false,
      allowStitch: true,
      brandOrganic: false,
      brandedContent: false
    });
    expect(parseConsent(undefined)).toBeUndefined();
  });

  it("keeps only the audiences TikTok returned for the account", async () => {
    mockFetchRoutes([
      {
        match: "/v2/post/publish/creator_info/query/",
        respond: () =>
          jsonResponse({
            data: {
              creator_nickname: "Nic",
              creator_username: "nicvandewetering",
              privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY", "SOMETHING_NEW"],
              comment_disabled: false,
              duet_disabled: true,
              max_video_post_duration_sec: 600
            },
            error: { code: "ok" }
          })
      }
    ]);

    const info = await fetchCreatorPostingInfo("tt-at");

    expect(info.privacyLevels).toEqual(["PUBLIC_TO_EVERYONE", "SELF_ONLY"]);
    expect(info.duetDisabled).toBe(true);
    expect(info.stitchDisabled).toBe(false);
    expect(info.maxVideoSeconds).toBe(600);
  });
});
