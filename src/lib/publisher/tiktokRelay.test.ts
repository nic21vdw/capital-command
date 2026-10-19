import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchRoutes, testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

let clipPath: string;

beforeAll(async () => {
  const dir = path.join(os.tmpdir(), `publisher-relay-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(2048, 7));
});

beforeEach(() => {
  vi.stubEnv("UPLOAD_POST_API_KEY", "up-key");
  vi.stubEnv("UPLOAD_POST_USER", "nic");
  vi.stubEnv("TIKTOK_CLIENT_KEY", "");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "");
  vi.stubEnv("TIKTOK_REFRESH_TOKEN", "");
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
    item: testItem({ platformIds: ["tiktok"], caption: "Wild moment", hashtags: ["#clips"], visibility: "public", ...overrides }),
    localPath: clipPath
  };
}

function form(request: { body?: unknown }): FormData {
  expect(request.body).toBeInstanceOf(FormData);
  return request.body as FormData;
}

describe("tiktok through Upload-Post", () => {
  it("counts as configured and leaves the inbox without a TikTok client of its own", async () => {
    const adapter = await loadAdapter();
    const { usesTiktokInbox } = await import("@/lib/publisher/tiktokInbox");
    expect(adapter.configured()).toBe(true);
    expect(usesTiktokInbox({})).toBe(false);
  });

  it("labels a TikTok slot as posting, not as an inbox draft, where only the build flag is visible", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "");
    vi.stubEnv("TIKTOK_RELAY", "1");
    const { pendingLabel } = await import("@/lib/publisher/nativeScheduling");
    expect(pendingLabel("tiktok", input().item, new Date(Date.parse(input().item.publishAt) - 3_600_000))).toBe("Posts at slot");
  });

  it("direct posts the clip publicly and follows the request until TikTok has it", async () => {
    const requests = mockFetchRoutes([
      {
        match: "/uploadposts/status",
        respond: () =>
          jsonResponse({
            status: "completed",
            results: [{ platform: "tiktok", success: true, url: "https://www.tiktok.com/@nic/video/1", post_id: "7400" }]
          })
      },
      { match: "api.upload-post.com/api/upload", respond: () => jsonResponse({ success: true, request_id: "req-1" }) }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish(input());

    const upload = requests[0];
    expect(upload.headers.Authorization).toBe("Apikey up-key");
    const body = form(upload);
    expect(body.get("user")).toBe("nic");
    expect(body.get("platform[]")).toBe("tiktok");
    expect(body.get("post_mode")).toBe("DIRECT_POST");
    expect(body.get("privacy_level")).toBe("PUBLIC_TO_EVERYONE");
    expect(body.get("disable_comment")).toBe("false");
    expect(body.get("async_upload")).toBe("true");
    expect(String(body.get("title"))).toContain("Wild moment");
    expect((body.get("video") as File).size).toBe(2048);
    expect(requests[1].url).toContain("request_id=req-1");
    expect(requests.some((r) => r.url.includes("open.tiktokapis.com"))).toBe(false);
    expect(result).toMatchObject({ status: "published", postId: "7400", containerId: "upload-post:req-1" });
  });

  it("keeps the creator's own audience and interaction answers", async () => {
    const requests = mockFetchRoutes([
      {
        match: "api.upload-post.com/api/upload",
        respond: () => jsonResponse({ success: true, results: { tiktok: { success: true, publish_id: "p-9" } } })
      }
    ]);
    const adapter = await loadAdapter();

    const result = await adapter.publish({
      ...input(),
      item: { ...input().item, tiktok: { delivery: "direct", privacyLevel: "SELF_ONLY", allowComment: true } }
    });

    const body = form(requests[0]);
    expect(body.get("privacy_level")).toBe("SELF_ONLY");
    expect(body.get("disable_comment")).toBe("false");
    expect(body.get("disable_duet")).toBe("true");
    expect(result.status).toBe("published");
  });

  it("resumes a request still in flight instead of uploading the clip again", async () => {
    const requests = mockFetchRoutes([
      { match: "/uploadposts/status", respond: () => jsonResponse({ status: "completed", results: [{ platform: "tiktok", success: false, error: "video too long" }] }) }
    ]);
    const adapter = await loadAdapter();
    const resumed = input();
    resumed.item.platforms.tiktok!.containerId = "upload-post:req-7";

    await expect(adapter.publish(resumed)).rejects.toThrow(/video too long/);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("request_id=req-7");
  });

  it("says what to fix when Upload-Post refuses TikTok on the plan", async () => {
    mockFetchRoutes([
      { match: "api.upload-post.com/api/upload", respond: () => jsonResponse({ success: false, message: "Plan restriction" }, { status: 403 }) }
    ]);
    const adapter = await loadAdapter();

    await expect(adapter.publish(input())).rejects.toThrow(/free plan/);
  });
});
