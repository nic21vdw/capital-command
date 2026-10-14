import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";

const state = vi.hoisted(() => ({ token: "tt-at" as string | null, audited: false }));

vi.mock("@/lib/publisher/tiktokAuth", () => ({ tiktokAccessToken: async () => state.token }));
vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({ tiktok: { audited: state.audited } })
}));

const get = async () => {
  const { GET } = await import("@/app/api/publish/tiktok/creator-info/route");
  return GET(new NextRequest("http://localhost:3000/api/publish/tiktok/creator-info?account=tiktok"));
};

beforeEach(() => {
  state.token = "tt-at";
  state.audited = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/publish/tiktok/creator-info", () => {
  it("hands the panel the nickname, avatar, audiences and longest video TikTok reports", async () => {
    mockFetchRoutes([
      {
        match: "/v2/post/publish/creator_info/query/",
        respond: () =>
          jsonResponse({
            data: {
              creator_nickname: "Nic",
              creator_username: "nicvandewetering",
              creator_avatar_url: "https://p16.tiktokcdn.example/a.jpeg",
              privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
              comment_disabled: false,
              duet_disabled: true,
              stitch_disabled: false,
              max_video_post_duration_sec: 600
            },
            error: { code: "ok" }
          })
      }
    ]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nickname: "Nic",
      handle: "nicvandewetering",
      avatarUrl: "https://p16.tiktokcdn.example/a.jpeg",
      privacyLevels: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: false,
      maxVideoSeconds: 600,
      audited: false
    });
  });

  it("says plainly when the account cannot post right now, instead of offering the panel", async () => {
    mockFetchRoutes([
      {
        match: "/v2/post/publish/creator_info/query/",
        respond: () =>
          jsonResponse({ data: {}, error: { code: "spam_risk_too_many_posts", message: "daily cap reached" } })
      }
    ]);

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.cannotPostNow).toBe(true);
    expect(body.error).toMatch(/try again later/i);
  });

  it("reports an unconnected account without calling TikTok", async () => {
    state.token = null;
    const requests = mockFetchRoutes([]);

    const response = await get();

    expect(response.status).toBe(409);
    expect(requests).toHaveLength(0);
  });
});
