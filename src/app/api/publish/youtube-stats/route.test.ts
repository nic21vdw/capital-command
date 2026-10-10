import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  seen: [] as Array<{ videoId: string; accountId: string }>,
  items: {} as Record<string, unknown>
}));

vi.mock("@/lib/publisher/accounts", () => ({ primaryAccountId: () => "yt-primary" }));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ get: async (id: string) => state.items[id] }) }));
vi.mock("@/lib/publisher/youtubeStats", () => ({
  liveStatsDeps: {},
  resolveYoutubeStats: async (requests: Array<{ videoId: string; accountId: string }>) => {
    state.seen = requests;
    return {
      status: "not-connected",
      message: "Connect YouTube",
      stats: Object.fromEntries(requests.map((r) => [r.videoId, { views: 1, likes: 0, comments: 0, fetchedAt: "2026-10-10T00:00:00.000Z" }])),
      items: {}
    };
  }
}));

const get = async (query: string) => {
  const { GET } = await import("@/app/api/publish/youtube-stats/route");
  return (await GET(new NextRequest(`http://localhost:3000/api/publish/youtube-stats?${query}`))).json();
};

describe("GET /api/publish/youtube-stats", () => {
  beforeEach(() => {
    state.seen = [];
    state.items = {
      q1: { id: "q1", accountId: "yt-clips", platforms: { youtube: { status: "published", postId: "FXdemo00001" } } },
      q2: { id: "q2", platforms: { youtube: { status: "scheduled", postId: "FXdemo00004" } } }
    };
  });

  it("resolves queue items to their video and channel, skipping legs that are not published", async () => {
    const body = await get("items=q1,q2,nope");
    expect(state.seen).toEqual([{ videoId: "FXdemo00001", accountId: "yt-clips" }]);
    expect(body.items).toEqual({ q1: "FXdemo00001" });
    expect(body.status).toBe("not-connected");
    expect(body.stats.FXdemo00001.views).toBe(1);
  });

  it("takes raw ids for the primary account and drops malformed ones", async () => {
    await get("ids=abcdefghijk,bad id,x");
    expect(state.seen).toEqual([{ videoId: "abcdefghijk", accountId: "yt-primary" }]);
  });
});
