import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

/**
 * Mocked integration test: asserts the outgoing requests match the Facebook
 * Graph API Video Reels contract (start upload → poll status → finish). No
 * live calls.
 */

const FB_PAGE = "10000000000000000";
const UPLOAD_URL = "https://rupload.facebook.com/video-upload/v23.0/video-1";

beforeEach(() => {
  vi.stubEnv("FB_PAGE_ID", FB_PAGE);
  vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "fb-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function loadAdapter() {
  return (await import("@/lib/publisher/adapters/facebook")).facebookAdapter;
}

/** The adapter and the error classes it throws, from one module registry. */
async function loadAdapterAndErrors() {
  const http = await import("@/lib/publisher/http");
  return { adapter: await loadAdapter(), http };
}

function wedged(uploadedAt: string, videoStatus = "uploading") {
  const requests = mockFetchRoutes([
    { match: "/video-77?fields=status", respond: () => jsonResponse({ status: { video_status: videoStatus } }) },
    { match: "/video_reels", respond: () => jsonResponse({ success: true }) }
  ]);
  const request = input();
  request.item.platforms.facebook = { status: "uploaded", attempts: 0, containerId: "video-77", uploadedAt };
  return { requests, request };
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
  it("publishes a Reel via the start → transfer → poll → finish flow", async () => {
    const requests = mockFetchRoutes([
      {
        match: "/video_reels",
        respond: (request) => {
          const phase = formBody(request).upload_phase;
          if (phase === "start") return jsonResponse({ video_id: "video-1", upload_url: UPLOAD_URL });
          if (phase === "finish") return jsonResponse({ success: true });
          throw new Error(`unexpected phase ${phase}`);
        }
      },
      { match: "rupload.facebook.com", respond: () => jsonResponse({ success: true }) },
      { match: "/video-1?fields=status", respond: () => jsonResponse({ status: { video_status: "ready" } }) }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish(input());

    // 1. Start opens the session and takes no file_url — passing one there is
    //    ignored, which left every upload waiting for bytes that never came.
    const start = requests[0];
    expect(start.url).toBe(`https://graph.facebook.com/v23.0/${FB_PAGE}/video_reels`);
    expect(formBody(start)).toEqual({
      upload_phase: "start",
      access_token: "fb-token"
    });

    // 2. Transfer: the hosted clip is named in a header on the upload url.
    const transfer = requests[1];
    expect(transfer.url).toBe(UPLOAD_URL);
    expect(transfer.method).toBe("POST");
    expect(transfer.headers).toEqual({
      Authorization: "OAuth fb-token",
      file_url: "https://media.example/clip.mp4"
    });

    // 3. Poll the video until status is ready.
    expect(requests[2].url).toContain("/video-1?fields=status");

    // 4. Finish: publish the Reel with the caption as the description.
    const finish = requests[3];
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

  it.each(["upload_complete", "processing_complete", "READY"])(
    "finishes a transfer Facebook reports as %s",
    async (videoStatus) => {
      const requests = mockFetchRoutes([
        { match: "/video-77?fields=status", respond: () => jsonResponse({ status: { video_status: videoStatus } }) },
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

      expect(result.status).toBe("published");
      expect(result.postId).toBe("video-77");
      expect(requests.filter((r) => r.url.includes("/video_reels"))).toHaveLength(1);
    }
  );

  it("gives up on an upload Facebook never fetched, and drops the dead handle", async () => {
    const { requests, request } = wedged(new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString());
    const { adapter, http } = await loadAdapterAndErrors();
    request.pollBudgetMs = 60_000;

    const error = await adapter.publish(request).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(http.AbandonedUploadError);
    expect((error as Error).message).toMatch(/never fetched the video/);
    expect((error as InstanceType<typeof http.AbandonedUploadError>).containerId).toBe("video-77");
    // One look, then out: a dead upload must not spend the run's polling budget.
    expect(requests).toHaveLength(1);
    expect(requests.some((r) => r.url.includes("/video_reels"))).toBe(false);
  });

  it("still resumes an upload that is genuinely processing inside the window", async () => {
    const { requests, request } = wedged(new Date(Date.now() - 10 * 60 * 1000).toISOString(), "processing");
    const { adapter, http } = await loadAdapterAndErrors();
    request.pollBudgetMs = 0;

    const error = await adapter.publish(request).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(http.StillProcessingError);
    expect((error as InstanceType<typeof http.StillProcessingError>).containerId).toBe("video-77");
    expect(requests).toHaveLength(1);
  });

  it("polls no longer than the budget the runner gave it", async () => {
    const { requests, request } = wedged(new Date(Date.now() - 10 * 60 * 1000).toISOString(), "processing");
    const { adapter, http } = await loadAdapterAndErrors();
    request.pollBudgetMs = 25_000;
    vi.useFakeTimers();

    const pending = adapter.publish(request).catch((thrown: unknown) => thrown);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(await pending).toBeInstanceOf(http.StillProcessingError);
    // 25s of budget at a 10s interval is three looks, not the old twenty-four.
    expect(requests).toHaveLength(3);
  });

  it("refuses non-public visibility (the API has no private Reels)", async () => {
    mockFetchRoutes([]);
    const adapter = await loadAdapter();
    const request = input();
    request.item.visibility = "private";
    await expect(adapter.publish(request)).rejects.toThrow(/always public/);
  });
});
