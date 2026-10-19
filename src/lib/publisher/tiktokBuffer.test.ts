import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetchRoutes, testItem, type RecordedRequest } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

beforeEach(() => {
  vi.stubEnv("BUFFER_API_KEY", "buf-key");
  vi.stubEnv("BUFFER_TIKTOK_CHANNEL_ID", "");
  vi.stubEnv("UPLOAD_POST_API_KEY", "");
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

function input(): PublishInput {
  return {
    item: testItem({ platformIds: ["tiktok"], caption: "Wild moment", hashtags: ["#clips"], visibility: "public" }),
    localPath: "clip.mp4",
    publicUrl: "https://media.example.com/clip.mp4"
  };
}

function gql(request: RecordedRequest): { query: string; variables: Record<string, unknown> } {
  return JSON.parse(String(request.body));
}

function buffer(answer: (query: string, variables: Record<string, unknown>) => unknown) {
  return mockFetchRoutes([
    {
      match: "api.buffer.com",
      respond: (request) => {
        const { query, variables } = gql(request);
        return jsonResponse({ data: answer(query, variables) });
      }
    }
  ]);
}

const CHANNELS = (query: string) =>
  query.includes("organizations")
    ? { account: { organizations: [{ id: "org-1" }] } }
    : query.includes("channels(")
      ? {
          channels: [
            { id: "ig-1", service: "instagram", isDisconnected: false, isLocked: false },
            { id: "tt-1", service: "tiktok", isDisconnected: false, isLocked: false }
          ]
        }
      : undefined;

describe("tiktok through Buffer", () => {
  it("counts as configured and keeps TikTok out of the inbox", async () => {
    const adapter = await loadAdapter();
    const { usesTiktokInbox } = await import("@/lib/publisher/tiktokInbox");
    expect(adapter.configured()).toBe(true);
    expect(usesTiktokInbox({})).toBe(false);
  });

  it("hands the clip to the account's TikTok channel to publish now, then follows it to sent", async () => {
    const handles: string[] = [];
    const requests = buffer((query) => {
      const channels = CHANNELS(query);
      if (channels) return channels;
      if (query.includes("createPost")) return { createPost: { post: { id: "post-1", status: "sending" } } };
      return { post: { id: "post-1", status: "sent", externalLink: "https://www.tiktok.com/@nic/video/1" } };
    });
    const adapter = await loadAdapter();

    const result = await adapter.publish({ ...input(), onHandle: async (handle) => void handles.push(handle) });

    expect(requests.every((r) => r.headers.Authorization === "Bearer buf-key")).toBe(true);
    const create = gql(requests.find((r) => gql(r).query.includes("createPost"))!);
    expect(create.variables.input).toMatchObject({
      channelId: "tt-1",
      schedulingType: "automatic",
      mode: "shareNow",
      assets: [{ video: { url: "https://media.example.com/clip.mp4" } }]
    });
    expect(String((create.variables.input as { text: string }).text)).toContain("Wild moment");
    expect(handles).toEqual(["buffer:post-1"]);
    expect(result).toMatchObject({ status: "published", postId: "https://www.tiktok.com/@nic/video/1", containerId: "buffer:post-1" });
  });

  it("follows a post already handed over instead of posting it twice", async () => {
    const requests = buffer(() => ({ post: { id: "post-7", status: "error", error: { message: "Video too short" } } }));
    const adapter = await loadAdapter();
    const resumed = input();
    resumed.item.platforms.tiktok!.containerId = "buffer:post-7";

    await expect(adapter.publish(resumed)).rejects.toThrow(/Video too short/);
    expect(requests).toHaveLength(1);
    expect(gql(requests[0]).variables).toEqual({ id: "post-7" });
  });

  it("uses the configured channel and says why Buffer refused", async () => {
    vi.stubEnv("BUFFER_TIKTOK_CHANNEL_ID", "tt-9");
    const requests = buffer(() => ({ createPost: { message: "Daily limit reached" } }));
    const adapter = await loadAdapter();

    await expect(adapter.publish(input())).rejects.toThrow(/Daily limit reached/);
    expect(requests).toHaveLength(1);
    expect((gql(requests[0]).variables.input as { channelId: string }).channelId).toBe("tt-9");
  });

  it("says to connect TikTok when the account has no TikTok channel", async () => {
    buffer((query) => (query.includes("organizations") ? { account: { organizations: [{ id: "org-1" }] } } : { channels: [] }));
    const adapter = await loadAdapter();

    await expect(adapter.publish(input())).rejects.toThrow(/no connected TikTok channel/);
  });
});
