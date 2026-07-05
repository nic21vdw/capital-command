import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

/**
 * Mocked integration test: asserts the outgoing requests match the Instagram
 * Graph API Content Publishing contract for Reels (create container → poll
 * status_code → media_publish). No live calls.
 */

const IG_USER = "17840000000000000";

beforeEach(() => {
  vi.stubEnv("IG_USER_ID", IG_USER);
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadAdapter() {
  return (await import("@/lib/publisher/adapters/instagram")).instagramAdapter;
}

function input(): PublishInput {
  return {
    item: testItem({
      platformIds: ["instagram"],
      visibility: "public",
      caption: "Big moment from the stream",
      hashtags: ["#clips"]
    }),
    localPath: "/tmp/clip.mp4",
    publicUrl: "https://media.example/clip.mp4"
  };
}

describe("instagram adapter", () => {
  it("publishes a Reel via the container → media_publish flow", async () => {
    const requests = mockFetchRoutes([
      { match: "content_publishing_limit", respond: () => jsonResponse({ data: [{ quota_usage: 3 }] }) },
      { match: `/${IG_USER}/media_publish`, respond: () => jsonResponse({ id: "media-789" }) },
      { match: `/${IG_USER}/media`, respond: () => jsonResponse({ id: "container-1" }) },
      { match: "/container-1", respond: () => jsonResponse({ status_code: "FINISHED" }) }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish(input());

    // 1. Publishing quota is checked first (respects the ~50/24h limit).
    expect(requests[0].url).toContain(`https://graph.facebook.com/v23.0/${IG_USER}/content_publishing_limit`);

    // 2. Container create: media_type=REELS with a public HTTPS video_url.
    const create = requests[1];
    expect(create.url).toBe(`https://graph.facebook.com/v23.0/${IG_USER}/media`);
    expect(formBody(create)).toEqual({
      media_type: "REELS",
      video_url: "https://media.example/clip.mp4",
      caption: "Big moment from the stream\n\n#clips",
      share_to_feed: "true",
      access_token: "ig-token"
    });

    // 3. Poll the container until FINISHED.
    expect(requests[2].url).toContain("/container-1?fields=status_code");

    // 4. Publish the container.
    const publish = requests[3];
    expect(publish.url).toBe(`https://graph.facebook.com/v23.0/${IG_USER}/media_publish`);
    expect(formBody(publish)).toEqual({ creation_id: "container-1", access_token: "ig-token" });

    expect(result.status).toBe("published");
    expect(result.postId).toBe("media-789");
  });

  it("resumes an existing container instead of creating a duplicate", async () => {
    const requests = mockFetchRoutes([
      { match: `/${IG_USER}/media_publish`, respond: () => jsonResponse({ id: "media-1" }) },
      { match: "/container-77", respond: () => jsonResponse({ status_code: "FINISHED" }) }
    ]);
    const adapter = await loadAdapter();

    const resumed = input();
    resumed.item.platforms.instagram = { status: "uploaded", attempts: 1, containerId: "container-77" };
    const result = await adapter.publish(resumed);

    // No quota check, no container create — straight to poll + publish.
    expect(requests.map((r) => r.url).some((url) => url.endsWith(`/${IG_USER}/media`))).toBe(false);
    expect(result.postId).toBe("media-1");
  });

  it("refuses non-public visibility (the API has no private Reels)", async () => {
    mockFetchRoutes([]);
    const adapter = await loadAdapter();
    const request = input();
    request.item.visibility = "private";
    await expect(adapter.publish(request)).rejects.toThrow(/always public/);
  });
});
