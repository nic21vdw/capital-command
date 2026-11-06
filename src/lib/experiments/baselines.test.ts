import { describe, expect, it } from "vitest";
import { accountBaselines } from "@/lib/experiments/baselines";
import { MIN_BASELINE_POSTS } from "@/lib/experiments/types";
import { HOUR, NOW, baselinePosts, postRecord } from "@/lib/experiments/test-helpers";

const WINDOW = 72 * HOUR;

describe("accountBaselines", () => {
  it("is the median views at the window across the account's posts", () => {
    const posts = baselinePosts("youtube", "youtube-primary", [100, 200, 300, 400, 5000]);
    const baseline = accountBaselines(posts, WINDOW, new Set()).get("youtube:youtube-primary");
    expect(baseline).toMatchObject({ views: 300, posts: 5 });
  });

  it("keeps platforms and accounts apart", () => {
    const posts = [
      ...baselinePosts("youtube", "youtube-primary", [100, 100, 100, 100, 100]),
      ...baselinePosts("youtube", "youtube-second", [900, 900, 900, 900, 900]),
      ...baselinePosts("instagram", "instagram-primary", [30, 30, 30, 30, 30])
    ];
    const baselines = accountBaselines(posts, WINDOW, new Set());
    expect(baselines.get("youtube:youtube-primary")?.views).toBe(100);
    expect(baselines.get("youtube:youtube-second")?.views).toBe(900);
    expect(baselines.get("instagram:instagram-primary")?.views).toBe(30);
  });

  it(`has no baseline for an account with fewer than ${MIN_BASELINE_POSTS} measured posts`, () => {
    const posts = baselinePosts("youtube", "youtube-primary", [100, 200, 300, 400]);
    expect(accountBaselines(posts, WINDOW, new Set()).has("youtube:youtube-primary")).toBe(false);
  });

  it("leaves the experiment's own posts out of the account's normal", () => {
    const posts = [
      ...baselinePosts("youtube", "youtube-primary", [100, 100, 100, 100, 100]),
      postRecord({ postId: "v1", itemId: "variant-item", views: 9000 }),
      postRecord({ postId: "v2", itemId: "variant-item-2", views: 9000 })
    ];
    const baseline = accountBaselines(posts, WINDOW, new Set(["variant-item", "variant-item-2"])).get("youtube:youtube-primary");
    expect(baseline).toMatchObject({ views: 100, posts: 5 });
  });

  it("skips posts that have not reached the window or cannot be measured", () => {
    const young = postRecord({ postId: "young", views: null, publishedAt: new Date(NOW.getTime() - 24 * HOUR) });
    young.history = [{ date: "2026-10-20", at: new Date(NOW.getTime() - HOUR).toISOString(), views: 100 }];
    const posts = [
      ...baselinePosts("youtube", "youtube-primary", [100, 100, 100, 100]),
      young,
      postRecord({ postId: "unread", views: null }),
      postRecord({ postId: "gone", views: 100, status: "gone" })
    ];
    expect(accountBaselines(posts, WINDOW, new Set()).has("youtube:youtube-primary")).toBe(false);
  });

  it("has no baseline when the median is zero, because every ratio against it would be infinite", () => {
    const posts = baselinePosts("youtube", "youtube-primary", [0, 0, 0, 0, 50]);
    expect(accountBaselines(posts, WINDOW, new Set()).has("youtube:youtube-primary")).toBe(false);
  });

  it("carries a median engagement rate when enough posts have one", () => {
    const posts = baselinePosts("youtube", "youtube-primary", [1000, 1000, 1000, 1000, 1000], 0.04);
    expect(accountBaselines(posts, WINDOW, new Set()).get("youtube:youtube-primary")?.engagementRate).toBeCloseTo(0.04, 5);
  });

  it("has a views baseline but no rate baseline when engagement was not reported", () => {
    const posts = baselinePosts("youtube", "youtube-primary", [1000, 1000, 1000, 1000, 1000], 0);
    const baseline = accountBaselines(posts, WINDOW, new Set()).get("youtube:youtube-primary");
    expect(baseline?.views).toBe(1000);
    expect(baseline?.engagementRate).toBeNull();
  });
});
