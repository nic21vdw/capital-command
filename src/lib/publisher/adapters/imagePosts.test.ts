import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PlatformId, PublishInput } from "@/lib/publisher/types";

/**
 * Mocked integration test for picture posts: asserts the outgoing requests
 * match the Graph API contracts (IG image container / CAROUSEL parent, FB
 * /photos and the unpublished-photos + /feed pair). No live calls.
 */

const IG_USER = "17840000000000000";
const FB_PAGE = "10000000000000000";

beforeEach(() => {
  vi.stubEnv("IG_USER_ID", IG_USER);
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.stubEnv("FB_PAGE_ID", FB_PAGE);
  vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "fb-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function imageInput(platform: PlatformId, urls: string[]): PublishInput {
  const paths = urls.map((_, index) => `data/carousels/deck/slide-${index + 1}.png`);
  return {
    item: testItem({
      platformIds: [platform],
      visibility: "public",
      mediaKind: "image",
      clipPath: paths[0],
      imagePaths: paths,
      caption: "The deck from today's stream",
      hashtags: ["#ai"]
    }),
    localPath: paths[0],
    publicUrl: urls[0],
    images: { localPaths: paths, publicUrls: urls }
  };
}

describe("Instagram picture posts", () => {
  it("publishes one image through container → media_publish", async () => {
    const requests = mockFetchRoutes([
      { match: "content_publishing_limit", respond: () => jsonResponse({ data: [{ quota_usage: 1 }] }) },
      { match: `/${IG_USER}/media_publish`, respond: () => jsonResponse({ id: "media-1" }) },
      { match: `/${IG_USER}/media`, respond: () => jsonResponse({ id: "container-1" }) },
      { match: "/container-1", respond: () => jsonResponse({ status_code: "FINISHED" }) }
    ]);
    const adapter = (await import("@/lib/publisher/adapters/instagram")).instagramAdapter;

    const result = await adapter.publish(imageInput("instagram", ["https://media.test/1.png"]));

    const create = requests[1];
    expect(create.url).toBe(`https://graph.facebook.com/v23.0/${IG_USER}/media`);
    expect(formBody(create)).toEqual({
      image_url: "https://media.test/1.png",
      caption: "The deck from today's stream\n\n#ai",
      access_token: "ig-token"
    });
    expect(result.status).toBe("published");
    expect(result.postId).toBe("media-1");
  });

  it("publishes a deck as a CAROUSEL parent over one child per picture", async () => {
    let child = 0;
    const requests = mockFetchRoutes([
      { match: "content_publishing_limit", respond: () => jsonResponse({ data: [{ quota_usage: 1 }] }) },
      { match: `/${IG_USER}/media_publish`, respond: () => jsonResponse({ id: "media-carousel" }) },
      {
        match: `/${IG_USER}/media`,
        respond: (request) =>
          jsonResponse({ id: formBody(request).media_type === "CAROUSEL" ? "parent-1" : `child-${(child += 1)}` })
      },
      { match: "/parent-1", respond: () => jsonResponse({ status_code: "FINISHED" }) }
    ]);
    const adapter = (await import("@/lib/publisher/adapters/instagram")).instagramAdapter;

    const result = await adapter.publish(
      imageInput("instagram", ["https://media.test/1.png", "https://media.test/2.png", "https://media.test/3.png"])
    );

    const children = requests.slice(1, 4).map(formBody);
    expect(children.map((body) => body.image_url)).toEqual([
      "https://media.test/1.png",
      "https://media.test/2.png",
      "https://media.test/3.png"
    ]);
    expect(children.every((body) => body.is_carousel_item === "true")).toBe(true);

    const parent = formBody(requests[4]);
    expect(parent.media_type).toBe("CAROUSEL");
    expect(parent.children).toBe("child-1,child-2,child-3");
    expect(parent.caption).toBe("The deck from today's stream\n\n#ai");

    expect(result.postId).toBe("media-carousel");
    expect(result.childContainerIds).toEqual(["child-1", "child-2", "child-3"]);
  });

  it("resumes a parent container rather than re-creating the deck", async () => {
    const requests = mockFetchRoutes([
      { match: `/${IG_USER}/media_publish`, respond: () => jsonResponse({ id: "media-9" }) },
      { match: "/parent-77", respond: () => jsonResponse({ status_code: "FINISHED" }) }
    ]);
    const adapter = (await import("@/lib/publisher/adapters/instagram")).instagramAdapter;

    const input = imageInput("instagram", ["https://media.test/1.png", "https://media.test/2.png"]);
    input.item.platforms.instagram = { status: "uploaded", attempts: 1, containerId: "parent-77" };
    const result = await adapter.publish(input);

    expect(requests.some((request) => request.url.endsWith(`/${IG_USER}/media`))).toBe(false);
    expect(result.postId).toBe("media-9");
  });

  it("refuses a picture post with no hosted URLs", async () => {
    mockFetchRoutes([]);
    const adapter = (await import("@/lib/publisher/adapters/instagram")).instagramAdapter;
    const input = imageInput("instagram", ["https://media.test/1.png"]);
    input.images = { localPaths: [], publicUrls: [] };
    await expect(adapter.publish(input)).rejects.toThrow(/public HTTPS URL/);
  });
});

describe("Facebook picture posts", () => {
  it("publishes one photo straight to the Page", async () => {
    const requests = mockFetchRoutes([
      { match: `/${FB_PAGE}/photos`, respond: () => jsonResponse({ id: "photo-1", post_id: "page_post-1" }) }
    ]);
    const adapter = (await import("@/lib/publisher/adapters/facebook")).facebookAdapter;

    const result = await adapter.publish(imageInput("facebook", ["https://media.test/1.png"]));

    expect(formBody(requests[0])).toEqual({
      url: "https://media.test/1.png",
      caption: "The deck from today's stream\n\n#ai",
      published: "true",
      access_token: "fb-token"
    });
    expect(result.status).toBe("published");
    expect(result.postId).toBe("photo-1");
  });

  it("publishes a deck as unpublished photos attached to one feed post", async () => {
    let photo = 0;
    const requests = mockFetchRoutes([
      { match: `/${FB_PAGE}/photos`, respond: () => jsonResponse({ id: `photo-${(photo += 1)}` }) },
      { match: `/${FB_PAGE}/feed`, respond: () => jsonResponse({ id: "page_post-9" }) }
    ]);
    const adapter = (await import("@/lib/publisher/adapters/facebook")).facebookAdapter;

    const result = await adapter.publish(
      imageInput("facebook", ["https://media.test/1.png", "https://media.test/2.png"])
    );

    expect(requests.slice(0, 2).map(formBody)).toEqual([
      { url: "https://media.test/1.png", published: "false", access_token: "fb-token" },
      { url: "https://media.test/2.png", published: "false", access_token: "fb-token" }
    ]);
    expect(formBody(requests[2])).toEqual({
      message: "The deck from today's stream\n\n#ai",
      "attached_media[0]": '{"media_fbid":"photo-1"}',
      "attached_media[1]": '{"media_fbid":"photo-2"}',
      access_token: "fb-token"
    });
    expect(result.postId).toBe("page_post-9");
    expect(result.childContainerIds).toEqual(["photo-1", "photo-2"]);
  });

  it("reuses photos already uploaded rather than uploading them twice", async () => {
    const requests = mockFetchRoutes([{ match: `/${FB_PAGE}/feed`, respond: () => jsonResponse({ id: "page_post-2" }) }]);
    const adapter = (await import("@/lib/publisher/adapters/facebook")).facebookAdapter;

    const input = imageInput("facebook", ["https://media.test/1.png", "https://media.test/2.png"]);
    input.item.platforms.facebook = { status: "uploaded", attempts: 1, childContainerIds: ["photo-a", "photo-b"] };
    const result = await adapter.publish(input);

    expect(requests.some((request) => request.url.endsWith(`/${FB_PAGE}/photos`))).toBe(false);
    expect(formBody(requests[0])["attached_media[0]"]).toBe('{"media_fbid":"photo-a"}');
    expect(result.postId).toBe("page_post-2");
  });
});

describe("the dry-run plan for a picture post", () => {
  it("describes pictures, not a video, on both platforms", async () => {
    const instagram = (await import("@/lib/publisher/adapters/instagram")).instagramAdapter;
    const facebook = (await import("@/lib/publisher/adapters/facebook")).facebookAdapter;
    const deck = imageInput("instagram", ["https://media.test/1.png", "https://media.test/2.png"]);

    const igPlan = instagram.buildPlan(deck);
    expect(igPlan.payload).toMatchObject({ media_type: "CAROUSEL", images: 2 });
    expect(JSON.stringify(igPlan.payload)).not.toContain("video");

    const fbPlan = facebook.buildPlan(deck);
    expect(fbPlan.endpoint).toContain("/photos");
    expect(fbPlan.payload).toMatchObject({ photos: 2 });
  });
});

describe("platforms that cannot take a picture post", () => {
  it("refuses at the adapter too, so a hand-edited queue item cannot slip through", async () => {
    mockFetchRoutes([]);
    vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-id");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-secret");
    vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh");
    vi.stubEnv("TIKTOK_CLIENT_KEY", "tt-key");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "tt-secret");
    vi.stubEnv("TIKTOK_REFRESH_TOKEN", "tt-refresh");
    vi.resetModules();

    const youtube = (await import("@/lib/publisher/adapters/youtube")).youtubeAdapter;
    const tiktok = (await import("@/lib/publisher/adapters/tiktok")).tiktokAdapter;

    await expect(youtube.publish(imageInput("youtube", ["https://media.test/1.png"]))).rejects.toThrow(/no API for picture posts/);
    await expect(tiktok.publish(imageInput("tiktok", ["https://media.test/1.png"]))).rejects.toThrow(/audited photo scope/);
  });
});
