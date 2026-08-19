import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

/**
 * Mocked integration test: asserts the outgoing requests match the TikTok
 * Content Posting API Direct Post contract (oauth/token refresh → video/init
 * with FILE_UPLOAD → chunk PUT → status/fetch). No live calls.
 */

// A connected machine has a real refresh token in data/publisher-tokens.json,
// and BOTH the adapter (via getCachedToken) and publisherConfig (which reads
// that file synchronously) prefer it over the .env seed. Pin the token to the
// env stub so the suite never reaches for the live one.
vi.mock("@/lib/publisher/tokens", () => ({
  getCachedToken: async () => null,
  setCachedToken: async () => undefined
}));

vi.mock("@/lib/publisher/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/config")>();
  return {
    ...actual,
    publisherConfig: () => {
      const config = actual.publisherConfig();
      return { ...config, tiktok: { ...config.tiktok, refreshToken: process.env.TIKTOK_REFRESH_TOKEN ?? null } };
    }
  };
});

const CLIP_BYTES = 4096;
let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `publisher-tt-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(CLIP_BYTES, 3));
});

beforeEach(() => {
  vi.stubEnv("TIKTOK_CLIENT_KEY", "tt-key");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "tt-secret");
  vi.stubEnv("TIKTOK_REFRESH_TOKEN", "tt-refresh");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadAdapter() {
  return (await import("@/lib/publisher/adapters/tiktok")).tiktokAdapter;
}

function input(overrides: Partial<PublishInput["item"]> = {}): PublishInput {
  return {
    item: testItem({ platformIds: ["tiktok"], caption: "Wild moment", hashtags: ["#clips"], ...overrides }),
    localPath: clipPath
  };
}

function routes(finalStatus: "PUBLISH_COMPLETE" | "SEND_TO_USER_INBOX" = "SEND_TO_USER_INBOX") {
  const init = () =>
    jsonResponse({
      data: { publish_id: "pub-1", upload_url: "https://upload.tiktok.example/u1" },
      error: { code: "ok" }
    });
  return mockFetchRoutes([
    {
      // Refresh token grant returns the same refresh_token (no rotation).
      match: "/v2/oauth/token/",
      respond: () => jsonResponse({ access_token: "tt-at", expires_in: 86400, refresh_token: "tt-refresh" })
    },
    // Inbox first: its path also ends in /video/init/, so it has to be matched
    // before the Direct Post route or every inbox call lands on the wrong one.
    { match: "/v2/post/publish/inbox/video/init/", respond: init },
    { match: "/v2/post/publish/video/init/", respond: init },
    { match: "upload.tiktok.example/u1", respond: () => new Response(null, { status: 201 }) },
    {
      match: "/v2/post/publish/status/fetch/",
      respond: () =>
        jsonResponse({
          data:
            finalStatus === "PUBLISH_COMPLETE"
              ? { status: finalStatus, publicaly_available_post_id: [7345678901234567890] }
              : { status: finalStatus },
          error: { code: "ok" }
        })
    }
  ]);
}

describe("tiktok adapter", () => {
  it("sends to the creator's TikTok inbox while unaudited", async () => {
    const requests = routes();
    const adapter = await loadAdapter();

    const result = await adapter.publish(input({ visibility: "public" }));

    // 1. OAuth refresh grant, form-encoded.
    const token = requests[0];
    expect(token.url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(formBody(token)).toEqual({
      client_key: "tt-key",
      client_secret: "tt-secret",
      grant_type: "refresh_token",
      refresh_token: "tt-refresh"
    });

    // 2. Inbox init: TikTok refuses Direct Post from an unaudited app to a
    //    public account, so the clip goes to the creator's inbox instead.
    //    post_info is omitted — the inbox flow rejects it.
    const init = requests[1];
    expect(init.url).toBe("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/");
    expect(init.headers.Authorization).toBe("Bearer tt-at");
    const body = JSON.parse(String(init.body));
    expect(body.post_info).toBeUndefined();
    expect(body.source_info).toEqual({
      source: "FILE_UPLOAD",
      video_size: CLIP_BYTES,
      chunk_size: CLIP_BYTES,
      total_chunk_count: 1
    });

    // 3. Binary chunk PUT with a Content-Range covering the whole file.
    const upload = requests[2];
    expect(upload.method).toBe("PUT");
    expect(upload.headers["Content-Range"]).toBe(`bytes 0-${CLIP_BYTES - 1}/${CLIP_BYTES}`);
    expect(upload.headers["Content-Type"]).toBe("video/mp4");

    // 4. SEND_TO_USER_INBOX is terminal — the last step is a tap in the TikTok
    //    app, so the runner must not keep polling for it.
    const status = requests[3];
    expect(JSON.parse(String(status.body))).toEqual({ publish_id: "pub-1" });

    expect(result.status).toBe("scheduled");
    expect(result.containerId).toBe("pub-1");
    expect(result.detail).toMatch(/inbox/i);
  });

  it("direct-posts with the configured visibility once TIKTOK_AUDITED=true", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    const result = await adapter.publish(input({ visibility: "public" }));

    const init = requests[1];
    expect(init.url).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    const body = JSON.parse(String(init.body));
    expect(body.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(body.post_info.title).toBe("Wild moment\n\n#clips");
    expect(result.status).toBe("published");
  });

  it("keeps a private item SELF_ONLY once audited", async () => {
    vi.stubEnv("TIKTOK_AUDITED", "true");
    const requests = routes("PUBLISH_COMPLETE");
    const adapter = await loadAdapter();

    await adapter.publish(input({ visibility: "private" }));

    expect(JSON.parse(String(requests[1].body)).post_info.privacy_level).toBe("SELF_ONLY");
  });

  it("defers instead of failing when TikTok's inbox backlog blocks the upload", async () => {
    mockFetchRoutes([
      {
        match: "/v2/oauth/token/",
        respond: () => jsonResponse({ access_token: "tt-at", expires_in: 86400, refresh_token: "tt-refresh" })
      },
      {
        match: "/v2/post/publish/inbox/video/init/",
        respond: () =>
          jsonResponse(
            { error: { code: "spam_risk_too_many_pending_share", message: "spam_risk_too_many_pending_share" } },
            { status: 400 }
          )
      }
    ]);
    const adapter = await loadAdapter();
    // resetModules gives the adapter its own copy of the module graph, so the
    // class to compare against has to come from that same copy.
    const { ThrottledError } = await import("@/lib/publisher/http");

    const error = await adapter.publish(input()).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ThrottledError);
    expect((error as InstanceType<typeof ThrottledError>).retryAfterMinutes).toBe(360);
    expect((error as Error).message).toMatch(/open the TikTok app/i);
  });

  it("resumes a pending publish_id by polling status only", async () => {
    const requests = routes();
    const adapter = await loadAdapter();

    const resumed = input();
    resumed.item.platforms.tiktok = { status: "uploaded", attempts: 1, containerId: "pub-9" };
    const result = await adapter.publish(resumed);

    expect(requests.some((r) => r.url.includes("/video/init/"))).toBe(false);
    expect(JSON.parse(String(requests[1].body))).toEqual({ publish_id: "pub-9" });
    expect(result.status).toBe("scheduled");
  });
});
