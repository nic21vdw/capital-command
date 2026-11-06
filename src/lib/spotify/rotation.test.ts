import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { jsonResponse, mockFetchRoutes } from "@/lib/publisher/test-helpers";

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  vi.stubEnv("SPOTIFY_CLIENT_ID", "sp-id");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "sp-secret");
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/storage/atomic-json");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a Spotify refresh that rotates the refresh token", () => {
  async function connected() {
    const { setCachedToken } = await import("@/lib/publisher/tokens");
    const { SPOTIFY_REFRESH_TOKEN_CACHE_KEY } = await import("@/lib/spotify/auth");
    await setCachedToken(SPOTIFY_REFRESH_TOKEN_CACHE_KEY, "old-refresh");
    return SPOTIFY_REFRESH_TOKEN_CACHE_KEY;
  }

  it("keeps the new refresh token", async () => {
    const key = await connected();
    mockFetchRoutes([{ match: "/api/token", respond: () => jsonResponse({ access_token: "sp-access", refresh_token: "new-refresh" }) }]);
    const { spotifyUserToken } = await import("@/lib/spotify/auth");
    const { getCachedToken } = await import("@/lib/publisher/tokens");

    expect(await spotifyUserToken()).toBe("sp-access");
    expect(await getCachedToken(key)).toBe("new-refresh");
  });

  it("still returns the access token when the new refresh token cannot be saved", async () => {
    await connected();
    const actual = await vi.importActual<typeof import("@/lib/storage/atomic-json")>("@/lib/storage/atomic-json");
    vi.doMock("@/lib/storage/atomic-json", () => ({
      ...actual,
      atomicWriteFile: vi.fn(async () => {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      })
    }));
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetchRoutes([{ match: "/api/token", respond: () => jsonResponse({ access_token: "sp-access", refresh_token: "new-refresh" }) }]);
    const { spotifyUserToken } = await import("@/lib/spotify/auth");

    expect(await spotifyUserToken()).toBe("sp-access");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Spotify"));
  });
});
