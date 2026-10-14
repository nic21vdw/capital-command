import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";

beforeEach(async () => {
  await rm(dataPath("platform-auth.json"), { force: true });
  await rm(dataPath("publisher-tokens.json"), { force: true });
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-client-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-client-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh-token");
  vi.stubEnv("TIKTOK_CLIENT_KEY", "tt-key");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "tt-secret");
  vi.stubEnv("TIKTOK_REFRESH_TOKEN", "tt-refresh-token");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function health(): Promise<PlatformHealthResponse> {
  const { GET } = await import("@/app/api/health/platforms/route");
  return (await GET()).json() as Promise<PlatformHealthResponse>;
}

const youtube = async () => (await import("@/lib/publisher/adapters/youtube")).youtubeAdapter;
const tiktok = async () => (await import("@/lib/publisher/adapters/tiktok")).tiktokAdapter;

describe("a rejected YouTube token refresh trips the auth breaker", () => {
  it("lists YouTube as broken for a revoked grant even though no upload was attempted", async () => {
    mockFetchRoutes([
      {
        match: "oauth2.googleapis.com/token",
        respond: () => jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 })
      }
    ]);

    await expect((await youtube()).validateAuth()).rejects.toThrow("expired or was revoked");

    expect(await health()).toMatchObject({
      ok: false,
      broken: [
        expect.objectContaining({
          platform: "youtube",
          accountId: "youtube-primary",
          reason: expect.stringContaining("expired or was revoked"),
          fixUrl: "/settings#accounts"
        })
      ]
    });
  });

  it("does not list YouTube for a Google outage or a dropped connection", async () => {
    mockFetchRoutes([{ match: "oauth2.googleapis.com/token", respond: () => new Response("backend error", { status: 503 }) }]);
    await expect((await youtube()).validateAuth()).rejects.toThrow("503");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await expect((await youtube()).validateAuth()).rejects.toThrow("network error");

    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });

  it("clears YouTube when the next refresh works", async () => {
    mockFetchRoutes([
      {
        match: "oauth2.googleapis.com/token",
        respond: () => jsonResponse({ error: "invalid_grant" }, { status: 400 })
      }
    ]);
    await expect((await youtube()).validateAuth()).rejects.toThrow();
    expect((await health()).ok).toBe(false);
    mockFetchRoutes([
      { match: "oauth2.googleapis.com/token", respond: () => jsonResponse({ access_token: "at", expires_in: 3600 }) }
    ]);

    await (await youtube()).validateAuth();

    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });
});

describe("a rejected TikTok token refresh trips the auth breaker", () => {
  it("lists TikTok as broken for an invalid refresh token even though no upload was attempted", async () => {
    mockFetchRoutes([
      {
        match: "/v2/oauth/token/",
        respond: () =>
          jsonResponse({ error: "invalid_grant", error_description: "Refresh token is invalid or expired." }, { status: 400 })
      }
    ]);

    await expect((await tiktok()).validateAuth()).rejects.toThrow("invalid_grant");

    expect(await health()).toMatchObject({
      ok: false,
      broken: [expect.objectContaining({ platform: "tiktok", accountId: "tiktok-primary", reason: expect.stringContaining("invalid_grant") })]
    });
  });

  it("does not list TikTok for a 5xx or a refresh that returns no token for a reason that is not about the grant", async () => {
    mockFetchRoutes([{ match: "/v2/oauth/token/", respond: () => new Response("gateway", { status: 502 }) }]);
    await expect((await tiktok()).validateAuth()).rejects.toThrow("502");
    mockFetchRoutes([{ match: "/v2/oauth/token/", respond: () => jsonResponse({ error: "rate_limit_exceeded" }) }]);
    await expect((await tiktok()).validateAuth()).rejects.toThrow("rate_limit_exceeded");

    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });

  it("clears TikTok when the next refresh works", async () => {
    mockFetchRoutes([{ match: "/v2/oauth/token/", respond: () => jsonResponse({ error: "invalid_grant" }, { status: 400 }) }]);
    await expect((await tiktok()).validateAuth()).rejects.toThrow();
    expect((await health()).ok).toBe(false);
    mockFetchRoutes([
      { match: "/v2/oauth/token/", respond: () => jsonResponse({ access_token: "at", expires_in: 86400, refresh_token: "tt-refresh-token" }) }
    ]);

    await (await tiktok()).validateAuth();

    expect(await health()).toMatchObject({ ok: true, broken: [] });
  });
});
