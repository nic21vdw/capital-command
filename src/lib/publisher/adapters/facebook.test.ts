import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

/**
 * Mocked integration test: asserts the outgoing requests match the Facebook
 * Graph API Video Reels contract (start upload → poll status → finish). No
 * live calls.
 */

const FB_PAGE = "10000000000000000";

beforeEach(() => {
  vi.stubEnv("FB_PAGE_ID", FB_PAGE);
  vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "fb-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadAdapter() {
  return (await import("@/lib/publisher/adapters/facebook")).facebookAdapter;
}

function input(): PublishInput {
  return {
    item: testItem({
      platformIds: ["facebook"],
      visibility: "public",
      caption: "Big moment from the stream",
      hashtags: ["#clips"]
    }),
    localPath: "/tmp/clip.mp4",
    publicUrl: "https://media.example/clip.mp4"
  };
}

describe("facebook adapter", () => {
  it("publishes a Reel via the start → poll → finish flow", async () => {
    const requests = mockFetchRoutes([
      {
        match: "/video_reels",
        respond: (request) => {
          const phase = formBody(request).upload_phase;
          if (phase === "start") return jsonResponse({ video_id: "video-1" });
          if (phase === "finish") return jsonResponse({ success: true });
          throw new Error(`unexpected phase ${phase}`);
        }
      },
      { match: "/video-1?fields=status", respond: () => jsonResponse({ status: { video_status: "ready" } }) }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish(input());

    // 1. Start: file_url pull, no binary upload needed.
    const start = requests[0];
    expect(start.url).toBe(`https://graph.facebook.com/v23.0/${FB_PAGE}/video_reels`);
    expect(formBody(start)).toEqual({
      upload_phase: "start",
      file_url: "https://media.example/clip.mp4",
      access_token: "fb-token"
    });

    // 2. Poll the video until status is ready.
    expect(requests[1].url).toContain("/video-1?fields=status");

    // 3. Finish: publish the Reel with the caption as the description.
    const finish = requests[2];
    expect(finish.url).toBe(`https://graph.facebook.com/v23.0/${FB_PAGE}/video_reels`);
    expect(formBody(finish)).toEqual({
      upload_phase: "finish",
      video_id: "video-1",
      video_state: "PUBLISHED",
      description: "Big moment from the stream\n\n#clips",
      access_token: "fb-token"
    });

    expect(result.status).toBe("published");
    expect(result.postId).toBe("video-1");
  });

  it("resumes an existing upload instead of starting a duplicate", async () => {
    const requests = mockFetchRoutes([
      { match: "/video-77?fields=status", respond: () => jsonResponse({ status: { video_status: "ready" } }) },
      {
        match: "/video_reels",
        respond: (request) => {
          expect(formBody(request).upload_phase).toBe("finish");
          return jsonResponse({ success: true });
        }
      }
    ]);
    const adapter = await loadAdapter();

    const resumed = input();
    resumed.item.platforms.facebook = { status: "uploaded", attempts: 1, containerId: "video-77" };
    const result = await adapter.publish(resumed);

    // Only one video_reels call (finish) — no start call to duplicate the upload.
    expect(requests.filter((r) => r.url.includes("/video_reels"))).toHaveLength(1);
    expect(result.postId).toBe("video-77");
  });

  it("refuses non-public visibility (the API has no private Reels)", async () => {
    mockFetchRoutes([]);
    const adapter = await loadAdapter();
    const request = input();
    request.item.visibility = "private";
    await expect(adapter.publish(request)).rejects.toThrow(/always public/);
  });
});
