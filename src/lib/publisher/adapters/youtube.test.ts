import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

/**
 * Mocked integration test: asserts the outgoing requests match the YouTube
 * Data API v3 resumable upload contract (videos.insert). No live calls.
 */

const FUTURE = "2027-01-15T18:30:00.000Z";
let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `publisher-yt-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(2048, 7));
});

beforeEach(() => {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-client-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-client-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadAdapter() {
  return (await import("@/lib/publisher/adapters/youtube")).youtubeAdapter;
}

function input(overrides: Partial<PublishInput["item"]> = {}): PublishInput {
  return { item: testItem({ publishAt: FUTURE, platformIds: ["youtube"], ...overrides }), localPath: clipPath };
}

describe("youtube adapter", () => {
  it("turns a revoked refresh grant into a clean reconnect instruction", async () => {
    mockFetchRoutes([
      {
        match: "oauth2.googleapis.com/token",
        respond: () =>
          jsonResponse(
            { error: "invalid_grant", error_description: "Token has been expired or revoked." },
            { status: 400 }
          )
      }
    ]);
    const adapter = await loadAdapter();

    await expect(adapter.validateAuth()).rejects.toThrow(
      "YouTube connection expired or was revoked. Reconnect YouTube to resume the upload automatically."
    );
  });

  it("uploads private with status.publishAt for a future public post", async () => {
    const requests = mockFetchRoutes([
      { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
      {
        match: "uploadType=resumable",
        respond: () => jsonResponse({}, { headers: { location: "https://upload.example/session-1" } })
      },
      { match: "upload.example/session-1", respond: () => jsonResponse({ id: "vid-123" }) }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish(input({ visibility: "public", title: "My clip", hashtags: ["#clips", "#shorts"] }));

    // 1. OAuth refresh-token grant.
    const token = requests[0];
    expect(formBody(token)).toEqual({
      client_id: "yt-client-id",
      client_secret: "yt-client-secret",
      refresh_token: "yt-refresh-token",
      grant_type: "refresh_token"
    });

    // 2. Resumable init: metadata body per videos.insert part=snippet,status.
    const init = requests[1];
    expect(init.url).toBe(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
    );
    expect(init.headers.Authorization).toBe("Bearer at-1");
    expect(init.headers["X-Upload-Content-Type"]).toBe("video/mp4");
    expect(init.headers["X-Upload-Content-Length"]).toBe("2048");
    const body = JSON.parse(String(init.body));
    expect(body.snippet.title).toBe("My clip");
    expect(body.snippet.tags).toEqual(["clips", "shorts"]);
    // Scheduled publishing contract: private now + RFC3339 publishAt.
    expect(body.status.privacyStatus).toBe("private");
    expect(body.status.publishAt).toBe("2027-01-15T18:30:00Z");
    expect(body.status.selfDeclaredMadeForKids).toBe(false);

    // 3. Bytes PUT to the session URL.
    const upload = requests[2];
    expect(upload.method).toBe("PUT");
    expect(upload.headers["Content-Type"]).toBe("video/mp4");
    expect(upload.headers["Content-Length"]).toBe("2048");

    expect(result.status).toBe("scheduled");
    expect(result.postId).toBe("vid-123");
  });

  it("uploads directly as private (no publishAt) when visibility is private", async () => {
    const requests = mockFetchRoutes([
      { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
      {
        match: "uploadType=resumable",
        respond: () => jsonResponse({}, { headers: { location: "https://upload.example/session-2" } })
      },
      { match: "upload.example/session-2", respond: () => jsonResponse({ id: "vid-456" }) }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish(input({ visibility: "private" }));

    const body = JSON.parse(String(requests[1].body));
    expect(body.status.privacyStatus).toBe("private");
    expect(body.status.publishAt).toBeUndefined();
    expect(result.status).toBe("published");
    expect(result.postId).toBe("vid-456");
  });

  it("parses a full-size video resource response (larger than the error-truncation limit)", async () => {
    // The real videos.insert response is a whole video resource — snippet with
    // thumbnails at five resolutions, tags, localizations — which runs well past
    // 2000 chars. The body must be parsed in full, not the truncated slice used
    // for error messages, or a successful upload reads back as unparseable JSON.
    const fullResource = {
      kind: "youtube#video",
      etag: "yVzc__mo7l64H3My5Exu93W9nbQ",
      id: "b6qz13I6kck",
      snippet: {
        publishedAt: "2026-07-07T18:16:38Z",
        channelId: "UCNF5WYdRhnWXtWnX6TlI-Xg",
        title: "My clip",
        description: "x".repeat(3000),
        tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`),
        categoryId: "22"
      }
    };
    const requests = mockFetchRoutes([
      { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
      {
        match: "uploadType=resumable",
        respond: () => jsonResponse({}, { headers: { location: "https://upload.example/session-3" } })
      },
      { match: "upload.example/session-3", respond: () => jsonResponse(fullResource) }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish(input({ visibility: "private" }));

    expect(JSON.stringify(fullResource).length).toBeGreaterThan(2000);
    expect(result.status).toBe("published");
    expect(result.postId).toBe("b6qz13I6kck");
    expect(requests).toHaveLength(3);
  });

  describe("finalize (verify the public flip after the slot time)", () => {
    it("marks published without touching the video when YouTube already flipped it", async () => {
      const requests = mockFetchRoutes([
        { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
        {
          match: "id=vid-123",
          respond: () => jsonResponse({ items: [{ status: { privacyStatus: "public", selfDeclaredMadeForKids: false } }] })
        }
      ]);
      const adapter = await loadAdapter();
      const item = testItem({ visibility: "public", platformIds: ["youtube"] });

      const result = await adapter.finalize!(item, { status: "scheduled", attempts: 0, postId: "vid-123" });

      expect(result.status).toBe("published");
      expect(result.postId).toBe("vid-123");
      // Token refresh + status check only — no videos.update.
      expect(requests).toHaveLength(2);
      expect(requests[1].method).toBe("GET");
    });

    it("forces privacyStatus public via videos.update when the video is still private", async () => {
      const requests = mockFetchRoutes([
        { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
        {
          match: "id=vid-123",
          respond: () =>
            jsonResponse({
              items: [
                {
                  status: {
                    privacyStatus: "private",
                    publishAt: "2027-01-15T18:30:00Z",
                    selfDeclaredMadeForKids: false,
                    embeddable: true
                  }
                }
              ]
            })
        },
        { match: "youtube/v3/videos?part=status", respond: () => jsonResponse({ id: "vid-123" }) }
      ]);
      const adapter = await loadAdapter();
      const item = testItem({ visibility: "public", platformIds: ["youtube"] });

      const result = await adapter.finalize!(item, { status: "scheduled", attempts: 0, postId: "vid-123" });

      const update = requests[2];
      expect(update.method).toBe("PUT");
      const body = JSON.parse(String(update.body));
      expect(body.id).toBe("vid-123");
      expect(body.status.privacyStatus).toBe("public");
      // The stale publishAt must not be resent; the rest of the part survives.
      expect(body.status.publishAt).toBeUndefined();
      expect(body.status.embeddable).toBe(true);
      expect(body.status.selfDeclaredMadeForKids).toBe(false);
      expect(result.status).toBe("published");
    });

    it("asks for a reconnect when the grant predates the privacy-update scope", async () => {
      mockFetchRoutes([
        { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
        {
          match: "id=vid-private",
          respond: () => jsonResponse({ items: [{ status: { privacyStatus: "private", publishAt: FUTURE } }] })
        },
        {
          match: "part=status",
          respond: () =>
            jsonResponse(
              { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } },
              { status: 403 }
            )
        }
      ]);
      const adapter = await loadAdapter();
      const item = testItem({ visibility: "public", platformIds: ["youtube"] });

      // The upload already succeeded, so the failure must name the fix rather
      // than leaking Google's raw JSON into the queue's error field.
      await expect(
        adapter.finalize!(item, { status: "scheduled", attempts: 0, postId: "vid-private" })
      ).rejects.toThrow(/Reconnect YouTube/);
    });

    it("verifies instead of uploading when publish() is called on a video that already exists", async () => {
      const requests = mockFetchRoutes([
        { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
        {
          match: "id=vid-123",
          respond: () => jsonResponse({ items: [{ status: { privacyStatus: "public" } }] })
        }
      ]);
      const adapter = await loadAdapter();
      const retried = input({ visibility: "public" });
      retried.item.platforms.youtube = { status: "pending", attempts: 0, postId: "vid-123" };

      const result = await adapter.publish(retried);

      expect(result.postId).toBe("vid-123");
      // Token refresh + status read. No resumable init, no second upload.
      expect(requests).toHaveLength(2);
      expect(requests.some((request) => request.url.includes("uploadType=resumable"))).toBe(false);
    });

    it("leaves a re-armed post scheduled rather than publishing it before its slot", async () => {
      mockFetchRoutes([
        { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
        {
          match: "id=vid-waiting",
          respond: () => jsonResponse({ items: [{ status: { privacyStatus: "private", publishAt: FUTURE } }] })
        }
      ]);
      const adapter = await loadAdapter();
      const item = testItem({ publishAt: FUTURE, visibility: "public", platformIds: ["youtube"] });

      const result = await adapter.finalize!(item, { status: "failed", attempts: 3, postId: "vid-waiting" });

      expect(result.status).toBe("scheduled");
      expect(result.postId).toBe("vid-waiting");
    });

    it("fails permanently when the video no longer exists", async () => {
      mockFetchRoutes([
        { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at-1", expires_in: 3600 }) },
        { match: "id=vid-gone", respond: () => jsonResponse({ items: [] }) }
      ]);
      const adapter = await loadAdapter();
      const item = testItem({ visibility: "public", platformIds: ["youtube"] });

      await expect(adapter.finalize!(item, { status: "scheduled", attempts: 0, postId: "vid-gone" })).rejects.toThrow(
        /not found/
      );
    });
  });
});
