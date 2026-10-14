import { describe, expect, it } from "vitest";
import { TIKTOK_BATCH_SIZE, fetchTiktokMetrics, parseTiktokVideos, tiktokSupport } from "@/lib/analytics/tiktok";
import { httpDeps } from "@/lib/analytics/test-helpers";

describe("tiktokSupport", () => {
  it("is unsupported while the app only asks for publishing scopes", () => {
    const support = tiktokSupport("user.info.basic,video.publish,video.upload");

    expect(support.supported).toBe(false);
    expect(support.supported ? "" : support.reason).toMatch(/video\.list/);
  });

  it("is supported once video.list is part of the grant", () => {
    expect(tiktokSupport("user.info.basic,video.list").supported).toBe(true);
  });
});

describe("parseTiktokVideos", () => {
  it("maps TikTok's counts", () => {
    const parsed = parseTiktokVideos({
      data: { videos: [{ id: "7001", view_count: 500, like_count: 40, comment_count: 6, share_count: 3 }] },
      error: { code: "ok" }
    });

    expect(parsed.get("7001")).toEqual({ views: 500, likes: 40, comments: 6, shares: 3 });
  });
});

describe("fetchTiktokMetrics", () => {
  it("posts the ids in batches and reads the counts back", async () => {
    const ids = Array.from({ length: 25 }, (_, index) => String(7000 + index));
    const { deps, calls } = httpDeps([
      {
        match: "/v2/video/query/",
        reply: (call) => ({
          body: {
            data: {
              videos: (JSON.parse(call.body!).filters.video_ids as string[]).map((id) => ({
                id,
                view_count: 1,
                like_count: 0,
                comment_count: 0,
                share_count: 0
              }))
            },
            error: { code: "ok" }
          }
        })
      }
    ]);

    const outcome = await fetchTiktokMetrics({ token: "tt" }, ids, deps);

    expect(TIKTOK_BATCH_SIZE).toBe(20);
    expect(calls.map((call) => JSON.parse(call.body!).filters.video_ids.length)).toEqual([20, 5]);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Bearer tt");
    expect(outcome.results.size).toBe(25);
    expect(outcome.results.get("7000")?.source).toBe("tiktok-video-query");
  });

  it("stops with a scope note when the grant has no video.list", async () => {
    const { deps } = httpDeps([
      {
        match: "/v2/video/query/",
        reply: { status: 401, body: { error: { code: "scope_not_authorized", message: "The user did not authorize the scope required" } } }
      }
    ]);

    const outcome = await fetchTiktokMetrics({ token: "tt" }, ["7000"], deps);

    expect(outcome.stopped?.kind).toBe("scope");
    expect(outcome.notes.join(" ")).toMatch(/video\.list/);
  });
});
