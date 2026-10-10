import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as startGoogle } from "./google/route";
import { GET as startTiktok } from "./tiktok/route";
import { GET as startSpotify } from "./spotify/route";

const request = (path: string) => new NextRequest(`http://localhost:3000${path}`);

beforeEach(() => {
  for (const name of [
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET"
  ]) {
    vi.stubEnv(name, "");
  }
});

afterEach(() => vi.unstubAllEnvs());

describe("pressing Sign in before the app credentials are saved", () => {
  it.each([
    ["YouTube", "youtube", startGoogle, "/api/auth/google", "Add the YouTube client ID and secret in Settings > Accounts first."],
    ["TikTok", "tiktok", startTiktok, "/api/auth/tiktok", "Add the TikTok client key and secret in Settings > Accounts first."],
    ["Spotify", "spotify", startSpotify, "/api/auth/spotify", "Add the Spotify client ID and secret in Settings > Accounts first."]
  ] as const)("sends %s back to Settings with a message instead of raw JSON", async (_label, platform, handler, path, message) => {
    const response = await handler(request(path));
    expect(response.status).toBe(307);
    // Relative, so the browser stays on the origin it opened the page at.
    const raw = response.headers.get("location") ?? "";
    expect(raw.startsWith("/settings")).toBe(true);
    const location = new URL(raw, "http://127.0.0.1:3100");
    expect(location.origin).toBe("http://127.0.0.1:3100");
    expect(location.pathname).toBe("/settings");
    expect(location.hash).toBe("#accounts");
    expect(location.searchParams.get("connect_error")).toBe(message);
    expect(location.searchParams.get("connect")).toBe(platform);
  });
});
