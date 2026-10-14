import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";
import {
  BRANDED_CONTENT_DECLARATION,
  BRANDED_PRIVATE_HINT,
  CreatorCannotPostError,
  DISCLOSURE_REQUIRED_HINT,
  MUSIC_USAGE_DECLARATION,
  brandedContentHint,
  complianceStatement,
  consentBlocker,
  consentProblem,
  disclosureNotice,
  disclosureOn,
  emptyConsent,
  fetchCreatorPostingInfo,
  parseConsent,
  privacyOptionHint,
  reconcileWithCreator,
  type TiktokCreatorPostingInfo
} from "@/lib/publisher/tiktokPost";
import type { TiktokPostOptions } from "@/lib/publisher/types";

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

const CONSENTED_AT = "2026-10-13T12:00:00.000Z";

function ready(overrides: Partial<TiktokPostOptions> = {}): TiktokPostOptions {
  return { ...emptyConsent(), privacyLevel: "SELF_ONLY", consentedAt: CONSENTED_AT, ...overrides };
}

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
    expect(consentProblem(ready(), CREATOR)).toBeNull();
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

  it("always shows the Music Usage Confirmation, and adds the Branded Content Policy when it applies", () => {
    expect(complianceStatement(emptyConsent())).toBe("By posting, you agree to TikTok's Music Usage Confirmation.");
    expect(complianceStatement({ ...emptyConsent(), brandOrganic: true })).toBe(MUSIC_USAGE_DECLARATION);
    expect(complianceStatement({ ...emptyConsent(), brandedContent: true })).toBe(
      "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."
    );
    expect(complianceStatement({ ...emptyConsent(), brandOrganic: true, brandedContent: true })).toBe(
      BRANDED_CONTENT_DECLARATION
    );
    expect(complianceStatement({ ...emptyConsent(), disclosure: true })).toBe(MUSIC_USAGE_DECLARATION);
  });

  it("labels the post in TikTok's own words", () => {
    expect(disclosureNotice(emptyConsent())).toBeNull();
    expect(disclosureNotice({ ...emptyConsent(), disclosure: true })).toBeNull();
    expect(disclosureNotice({ ...emptyConsent(), brandOrganic: true })).toBe(
      "Your video will be labeled as 'Promotional content'"
    );
    expect(disclosureNotice({ ...emptyConsent(), brandedContent: true })).toBe(
      "Your video will be labeled as 'Paid partnership'"
    );
    expect(disclosureNotice({ ...emptyConsent(), brandOrganic: true, brandedContent: true })).toBe(
      "Your video will be labeled as 'Paid partnership'"
    );
  });

  it("treats the disclosure as on from the toggle alone, with nothing ticked", () => {
    expect(disclosureOn(emptyConsent())).toBe(false);
    expect(disclosureOn({ ...emptyConsent(), disclosure: true })).toBe(true);
    expect(disclosureOn({ ...emptyConsent(), brandOrganic: true })).toBe(true);
  });

  it("refuses a switched-on disclosure that says nothing about who is promoted", () => {
    const consent = ready({ disclosure: true });

    expect(consentProblem(consent, CREATOR)).toBe(
      "You need to indicate if your content promotes yourself, a third party, or both."
    );
    expect(DISCLOSURE_REQUIRED_HINT).toBe(consentProblem(consent, CREATOR));
    expect(consentProblem({ ...consent, brandOrganic: true }, CREATOR)).toBeNull();
    expect(consentProblem({ ...consent, brandedContent: true, privacyLevel: "PUBLIC_TO_EVERYONE" }, CREATOR)).toBeNull();
  });

  it("refuses a direct post the creator has not explicitly agreed to", () => {
    const unagreed = { ...emptyConsent(), privacyLevel: "SELF_ONLY" as const };

    expect(consentProblem(unagreed, CREATOR)).toMatch(/agree/i);
    expect(consentProblem({ ...unagreed, consentedAt: CONSENTED_AT }, CREATOR)).toBeNull();
  });

  it("refuses a video longer than the account may post, allowing a second for container rounding", () => {
    expect(consentProblem(ready(), CREATOR, 602)).toBe(
      "This clip is 602s long and this TikTok account can post videos up to 600s."
    );
    expect(consentProblem(ready(), CREATOR, 601)).toBeNull();
    expect(consentProblem(ready(), CREATOR, 600)).toBeNull();
    expect(consentProblem(ready(), { ...CREATOR, maxVideoSeconds: null }, 9999)).toBeNull();
  });

  it("refuses to post when TikTok offered the account no audience at all", () => {
    expect(consentProblem(ready(), { ...CREATOR, privacyLevels: [] })).toMatch(/did not offer any audience/i);
  });

  it("keeps Only you and Branded content from being picked together", () => {
    const branded = ready({ privacyLevel: "PUBLIC_TO_EVERYONE", brandedContent: true });

    expect(privacyOptionHint("SELF_ONLY", branded)).toBe("Branded content visibility cannot be set to private.");
    expect(BRANDED_PRIVATE_HINT).toBe("Branded content visibility cannot be set to private.");
    expect(privacyOptionHint("PUBLIC_TO_EVERYONE", branded)).toBeNull();
    expect(privacyOptionHint("SELF_ONLY", ready({ brandOrganic: true }))).toBeNull();
    expect(brandedContentHint(ready())).toBe(BRANDED_PRIVATE_HINT);
    expect(brandedContentHint(ready({ privacyLevel: "PUBLIC_TO_EVERYONE" }))).toBeNull();
  });

  it("blocks Schedule until creator_info has answered, then holds the answers against it", () => {
    const answered = ready({ privacyLevel: "PUBLIC_TO_EVERYONE" });

    expect(consentBlocker(undefined, { status: "loading" })).toBeNull();
    expect(consentBlocker({ delivery: "inbox" }, { status: "loading" })).toBeNull();
    expect(consentBlocker(answered, { status: "loading" })).toMatch(/reading what this tiktok account allows/i);
    expect(consentBlocker(answered, { status: "error", message: "TikTok would not answer." })).toBe(
      "TikTok would not answer."
    );
    expect(consentBlocker(answered, { status: "ready", info: CREATOR })).toBeNull();
    expect(consentBlocker(answered, { status: "ready", info: CREATOR }, 700)).toMatch(/up to 600s/);
    expect(consentBlocker(answered, { status: "ready", info: CREATOR }, 601)).toBeNull();
  });

  it("drops an answer the creator's settings no longer allow", () => {
    const stale = ready({ allowDuet: true, allowComment: true });

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

  it("keeps the disclosure toggle only when it is exactly true", () => {
    expect(parseConsent({ delivery: "direct", disclosure: true })?.disclosure).toBe(true);
    expect(parseConsent({ delivery: "direct", disclosure: "on" })?.disclosure).toBeUndefined();
  });

  it("stops at an account TikTok says cannot post right now", async () => {
    const respondWith = (code: string) =>
      mockFetchRoutes([
        {
          match: "/v2/post/publish/creator_info/query/",
          respond: () => jsonResponse({ data: {}, error: { code, message: code } })
        }
      ]);

    respondWith("spam_risk_too_many_posts");
    const limited = await fetchCreatorPostingInfo("tt-at").catch((thrown: unknown) => thrown);
    expect(limited).toBeInstanceOf(CreatorCannotPostError);
    expect((limited as CreatorCannotPostError).retryAfterMinutes).toBe(720);
    expect((limited as Error).message).toMatch(/try again later/i);

    respondWith("reached_active_user_cap");
    const capped = await fetchCreatorPostingInfo("tt-at").catch((thrown: unknown) => thrown);
    expect((capped as CreatorCannotPostError).retryAfterMinutes).toBe(60);

    respondWith("spam_risk_user_banned_from_posting");
    const banned = await fetchCreatorPostingInfo("tt-at").catch((thrown: unknown) => thrown);
    expect(banned).toBeInstanceOf(CreatorCannotPostError);
    expect((banned as CreatorCannotPostError).retryAfterMinutes).toBeNull();
  });

  it("reads the same refusals when TikTok sends them as a 4xx instead of a 200", async () => {
    const refuse = (status: number, code: string) =>
      mockFetchRoutes([
        {
          match: "/v2/post/publish/creator_info/query/",
          respond: () => jsonResponse({ data: {}, error: { code, message: code } }, { status })
        }
      ]);
    const fail = () => fetchCreatorPostingInfo("tt-at").catch((thrown: unknown) => thrown);

    refuse(400, "reached_active_user_cap");
    const capped = await fail();
    expect(capped).toBeInstanceOf(CreatorCannotPostError);
    expect((capped as CreatorCannotPostError).code).toBe("reached_active_user_cap");
    expect((capped as CreatorCannotPostError).retryAfterMinutes).toBe(60);

    refuse(403, "spam_risk_user_banned_from_posting");
    const banned = await fail();
    expect(banned).toBeInstanceOf(CreatorCannotPostError);
    expect((banned as CreatorCannotPostError).retryAfterMinutes).toBeNull();

    refuse(429, "rate_limit_exceeded");
    const limited = await fail();
    expect(limited).toBeInstanceOf(CreatorCannotPostError);
    expect((limited as CreatorCannotPostError).retryAfterMinutes).toBe(60);
    expect((limited as Error).message).toMatch(/try again later/i);

    refuse(400, "something_else_entirely");
    const unknown = await fail();
    expect(unknown).not.toBeInstanceOf(CreatorCannotPostError);
  });

  it("treats a rate limit in a 200 body as a wait, not a failure", async () => {
    mockFetchRoutes([
      {
        match: "/v2/post/publish/creator_info/query/",
        respond: () => jsonResponse({ data: {}, error: { code: "rate_limit_exceeded", message: "slow down" } })
      }
    ]);

    const error = await fetchCreatorPostingInfo("tt-at").catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(CreatorCannotPostError);
    expect((error as CreatorCannotPostError).retryAfterMinutes).toBe(60);
  });

  it("returns the avatar and the longest video the account may post", async () => {
    mockFetchRoutes([
      {
        match: "/v2/post/publish/creator_info/query/",
        respond: () =>
          jsonResponse({
            data: {
              creator_nickname: "Nic",
              creator_avatar_url: "https://p16.tiktokcdn.example/a.jpeg",
              privacy_level_options: ["SELF_ONLY"],
              max_video_post_duration_sec: 300
            },
            error: { code: "ok" }
          })
      }
    ]);

    const info = await fetchCreatorPostingInfo("tt-at");

    expect(info.avatarUrl).toBe("https://p16.tiktokcdn.example/a.jpeg");
    expect(info.maxVideoSeconds).toBe(300);
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
