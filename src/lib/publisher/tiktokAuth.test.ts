import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formBody, jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";

/**
 * The Connect TikTok flow. TikTok's desktop Login Kit is the only variant that
 * accepts a localhost redirect, and it requires PKCE with a HEX-encoded SHA256
 * challenge — so these tests pin the challenge encoding, the verifier round
 * trip, and that the refresh token lands in the server-side cache.
 */

const cache = new Map<string, string>();

vi.mock("@/lib/publisher/tokens", () => ({
  getCachedToken: async (key: string) => cache.get(key) ?? null,
  setCachedToken: async (key: string, value: string) => {
    cache.set(key, value);
  }
}));

const REDIRECT = "http://localhost:3000/api/auth/tiktok/callback";

beforeEach(() => {
  cache.clear();
  vi.stubEnv("TIKTOK_CLIENT_KEY", "tt-key");
  vi.stubEnv("TIKTOK_CLIENT_SECRET", "tt-secret");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function load() {
  return import("@/lib/publisher/tiktokAuth");
}

describe("tiktokAuthUrl", () => {
  it("sends a hex SHA256 challenge for the verifier it stored", async () => {
    const { tiktokAuthUrl } = await load();
    const url = new URL(await tiktokAuthUrl(REDIRECT));

    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("tt-key");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("scope")).toContain("video.publish");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();

    const verifier = cache.get("tiktok.codeVerifier");
    expect(verifier).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier!).digest("hex"));
  });

  it("refuses to start without client credentials", async () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "");
    const { tiktokAuthUrl } = await load();
    await expect(tiktokAuthUrl(REDIRECT)).rejects.toThrow(/TIKTOK_CLIENT_KEY/);
  });
});

describe("exchangeTiktokCode", () => {
  it("exchanges the code with the verifier and caches the refresh token", async () => {
    const requests = mockFetchRoutes([
      {
        match: "/v2/oauth/token/",
        respond: () => jsonResponse({ access_token: "tt-at", refresh_token: "tt-refresh", open_id: "open-1" })
      },
      {
        match: "/v2/user/info/",
        respond: () =>
          jsonResponse({
            data: { user: { display_name: "Nic", avatar_url: "https://cdn/a.jpg", username: "nicvandewetering" } }
          })
      }
    ]);
    const { tiktokAuthUrl, exchangeTiktokCode, tiktokCreatorInfo } = await load();
    await tiktokAuthUrl(REDIRECT);
    const verifier = cache.get("tiktok.codeVerifier")!;

    await exchangeTiktokCode("abc%2A", REDIRECT);

    const exchange = formBody(requests.find((request) => request.url.includes("/oauth/token/"))!);
    expect(exchange.grant_type).toBe("authorization_code");
    // TikTok URL-encodes the code on the callback and wants it decoded back.
    expect(exchange.code).toBe("abc*");
    expect(exchange.code_verifier).toBe(verifier);
    expect(exchange.client_secret).toBe("tt-secret");
    expect(exchange.redirect_uri).toBe(REDIRECT);

    expect(cache.get("tiktok.refreshToken")).toBe("tt-refresh");
    // The verifier is single-use — a replayed callback must not reuse it.
    expect(cache.get("tiktok.codeVerifier")).toBe("");
    expect(await tiktokCreatorInfo()).toEqual({
      title: "Nic",
      thumbnail: "https://cdn/a.jpg",
      handle: "nicvandewetering"
    });
  });

  // A grant made without user.info.basic 401s on the user lookup, which is the
  // state a connection lands in when only the posting scopes were approved.
  it("falls back to the posting creator query when user.info is not authorized", async () => {
    mockFetchRoutes([
      {
        match: "/v2/oauth/token/",
        respond: () => jsonResponse({ access_token: "tt-at", refresh_token: "tt-refresh" })
      },
      {
        match: "/v2/user/info/",
        respond: () => jsonResponse({ error: { code: "scope_not_authorized" } }, { status: 401 })
      },
      {
        match: "/v2/post/publish/creator_info/query/",
        respond: () =>
          jsonResponse({
            data: {
              creator_nickname: "Nic",
              creator_username: "nicvandewetering",
              creator_avatar_url: "https://cdn/a.jpg"
            }
          })
      }
    ]);
    const { tiktokAuthUrl, exchangeTiktokCode, tiktokCreatorInfo } = await load();
    await tiktokAuthUrl(REDIRECT);

    await exchangeTiktokCode("abc", REDIRECT);

    expect(await tiktokCreatorInfo()).toEqual({
      title: "Nic",
      thumbnail: "https://cdn/a.jpg",
      handle: "nicvandewetering"
    });
  });

  it("still connects when every profile lookup fails", async () => {
    mockFetchRoutes([
      {
        match: "/v2/oauth/token/",
        respond: () => jsonResponse({ access_token: "tt-at", refresh_token: "tt-refresh" })
      },
      { match: "/v2/user/info/", respond: () => jsonResponse({ error: "nope" }, { status: 403 }) },
      {
        match: "/v2/post/publish/creator_info/query/",
        respond: () => jsonResponse({ error: "nope" }, { status: 403 })
      }
    ]);
    const { tiktokAuthUrl, exchangeTiktokCode, tiktokCreatorInfo } = await load();
    await tiktokAuthUrl(REDIRECT);

    await exchangeTiktokCode("abc", REDIRECT);

    expect(cache.get("tiktok.refreshToken")).toBe("tt-refresh");
    expect(await tiktokCreatorInfo()).toBeNull();
  });

  it("reports a missing verifier instead of calling TikTok", async () => {
    const requests = mockFetchRoutes([
      { match: "/v2/oauth/token/", respond: () => jsonResponse({ refresh_token: "tt-refresh" }) }
    ]);
    const { exchangeTiktokCode } = await load();

    await expect(exchangeTiktokCode("abc", REDIRECT)).rejects.toThrow(/expired/i);
    expect(requests).toHaveLength(0);
  });

  it("surfaces TikTok's error when no refresh token comes back", async () => {
    mockFetchRoutes([
      {
        match: "/v2/oauth/token/",
        respond: () => jsonResponse({ error: "invalid_grant", error_description: "code expired" })
      }
    ]);
    const { tiktokAuthUrl, exchangeTiktokCode } = await load();
    await tiktokAuthUrl(REDIRECT);

    await expect(exchangeTiktokCode("abc", REDIRECT)).rejects.toThrow(/invalid_grant/);
    expect(cache.get("tiktok.refreshToken")).toBeUndefined();
  });
});

describe("tiktokRedirectUri", () => {
  it("defaults to the request origin and honours an explicit override", async () => {
    const { tiktokRedirectUri } = await load();
    expect(tiktokRedirectUri("http://localhost:3000")).toBe(REDIRECT);
    vi.stubEnv("TIKTOK_REDIRECT_URI", "http://127.0.0.1:3000/api/auth/tiktok/callback");
    expect(tiktokRedirectUri("http://localhost:3000")).toBe("http://127.0.0.1:3000/api/auth/tiktok/callback");
  });
});
