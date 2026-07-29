import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLaunchStats, normalizeSlug, productHuntConfigured } from "@/lib/launch/producthunt";

const POST = {
  id: "p1",
  name: "CoLateral",
  tagline: "An AI workspace for structural engineers",
  slug: "colateral",
  url: "https://www.producthunt.com/posts/colateral",
  votesCount: 214,
  commentsCount: 37,
  featuredAt: "2026-09-15T07:01:00Z",
  createdAt: "2026-09-15T07:01:00Z"
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function mockFetch(handler: (body: { query: string; variables: Record<string, unknown> }) => Response) {
  const spy = vi.fn(async (_url: string, init: RequestInit) => handler(JSON.parse(String(init.body))));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("normalizeSlug", () => {
  it("accepts a bare slug, a listing URL, and stray whitespace", () => {
    expect(normalizeSlug("colateral")).toBe("colateral");
    expect(normalizeSlug("  CoLateral  ")).toBe("colateral");
    expect(normalizeSlug("https://www.producthunt.com/posts/colateral")).toBe("colateral");
    expect(normalizeSlug("https://www.producthunt.com/posts/colateral?ref=x#comments")).toBe("colateral");
    expect(normalizeSlug("https://www.producthunt.com/products/colateral/")).toBe("colateral");
    expect(normalizeSlug("   ")).toBe("");
  });
});

describe("fetchLaunchStats", () => {
  beforeEach(() => {
    process.env.PRODUCT_HUNT_TOKEN = "token-123";
  });

  afterEach(() => {
    delete process.env.PRODUCT_HUNT_TOKEN;
    vi.unstubAllGlobals();
  });

  it("reads votes, comments, and the rank off the day's leaderboard", async () => {
    mockFetch((body) =>
      body.query.includes("post(slug")
        ? jsonResponse({ data: { post: POST } })
        : jsonResponse({
            data: {
              posts: {
                edges: [
                  { node: { id: "other", slug: "other", votesCount: 900 } },
                  { node: { id: "p1", slug: "colateral", votesCount: 214 } },
                  { node: { id: "third", slug: "third", votesCount: 10 } }
                ]
              }
            }
          })
    );

    const stats = await fetchLaunchStats("https://www.producthunt.com/posts/colateral");
    expect(stats.votes).toBe(214);
    expect(stats.comments).toBe(37);
    expect(stats.rank).toBe(2);
    expect(stats.dayLaunchCount).toBe(3);
    expect(stats.url).toBe(POST.url);
  });

  it("sends the bearer token on every call", async () => {
    const spy = mockFetch(() => jsonResponse({ data: { post: POST } }));
    await fetchLaunchStats("colateral");
    const init = spy.mock.calls[0][1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("returns a null rank when the launch is outside the leaderboard", async () => {
    mockFetch((body) =>
      body.query.includes("post(slug")
        ? jsonResponse({ data: { post: POST } })
        : jsonResponse({ data: { posts: { edges: [{ node: { id: "other", slug: "other", votesCount: 900 } }] } } })
    );

    const stats = await fetchLaunchStats("colateral");
    expect(stats.rank).toBeNull();
    expect(stats.votes).toBe(214);
  });

  it("still reports votes when the leaderboard call fails", async () => {
    mockFetch((body) => (body.query.includes("post(slug") ? jsonResponse({ data: { post: POST } }) : jsonResponse({}, 500)));

    const stats = await fetchLaunchStats("colateral");
    expect(stats.rank).toBeNull();
    expect(stats.dayLaunchCount).toBeNull();
    expect(stats.votes).toBe(214);
  });

  it("explains a rejected token", async () => {
    mockFetch(() => jsonResponse({}, 401));
    await expect(fetchLaunchStats("colateral")).rejects.toThrow(/PRODUCT_HUNT_TOKEN/);
  });

  it("explains a rate limit", async () => {
    mockFetch(() => jsonResponse({}, 429));
    await expect(fetchLaunchStats("colateral")).rejects.toThrow(/rate limit/i);
  });

  it("surfaces a GraphQL error message", async () => {
    mockFetch(() => jsonResponse({ errors: [{ message: "Field 'nope' doesn't exist" }] }));
    await expect(fetchLaunchStats("colateral")).rejects.toThrow(/doesn't exist/);
  });

  it("reports an unknown slug", async () => {
    mockFetch(() => jsonResponse({ data: { post: null } }));
    await expect(fetchLaunchStats("colateral")).rejects.toThrow(/No Product Hunt listing/);
  });

  it("refuses to call out with no slug", async () => {
    const spy = mockFetch(() => jsonResponse({ data: { post: POST } }));
    await expect(fetchLaunchStats("  ")).rejects.toThrow(/slug or listing URL/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses to call out with no token", async () => {
    delete process.env.PRODUCT_HUNT_TOKEN;
    expect(productHuntConfigured()).toBe(false);
    await expect(fetchLaunchStats("colateral")).rejects.toThrow(/PRODUCT_HUNT_TOKEN/);
  });
});
