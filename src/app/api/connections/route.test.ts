import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { credentialSources, credentialsPresent, saveCredentials } from "@/lib/publisher/credentials";
import { accountIdConfigured } from "@/lib/publisher/accounts";
import { spotifyConnected } from "@/lib/spotify/auth";

vi.mock("@/lib/publisher/credentials", () => ({
  credentialsPresent: vi.fn(),
  credentialSources: vi.fn(),
  saveCredentials: vi.fn()
}));
vi.mock("@/lib/publisher/accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/accounts")>()),
  accountIdConfigured: vi.fn()
}));
vi.mock("@/lib/spotify/auth", () => ({
  spotifyConnected: vi.fn(),
  spotifyRedirectUri: (origin: string) => `${origin.replace("localhost", "127.0.0.1")}/api/auth/spotify/callback`
}));

const present = {
  YOUTUBE_CLIENT_ID: true,
  YOUTUBE_CLIENT_SECRET: true,
  TIKTOK_CLIENT_KEY: true,
  TIKTOK_CLIENT_SECRET: true,
  SPOTIFY_CLIENT_ID: true,
  SPOTIFY_CLIENT_SECRET: true
};

describe("account setup status", () => {
  beforeEach(() => {
    vi.mocked(credentialsPresent).mockResolvedValue(present);
    vi.mocked(accountIdConfigured).mockResolvedValue(false);
    vi.mocked(spotifyConnected).mockResolvedValue(false);
    vi.mocked(credentialSources).mockResolvedValue({});
    vi.mocked(saveCredentials).mockResolvedValue();
  });

  it("keeps saved app credentials separate from completed sign-in", async () => {
    const response = await GET(new Request("http://localhost:3000/api/connections"));
    expect(await response.json()).toMatchObject({
      present,
      connected: { youtube: false, tiktok: false, spotify: false }
    });
  });

  it("gives the exact redirect URI to register for each sign-in", async () => {
    vi.stubEnv("TIKTOK_REDIRECT_URI", "");
    const body = await (await GET(new Request("http://localhost:3000/api/connections"))).json();
    expect(body.redirectUris).toEqual({
      youtube: "http://localhost:3000/api/auth/google/callback",
      tiktok: "http://localhost:3000/api/auth/tiktok/callback",
      // Spotify refuses localhost, so the address to register is the loopback IP.
      spotify: "http://127.0.0.1:3000/api/auth/spotify/callback",
      linkedin: "http://localhost:3000/api/linkedin/callback"
    });
    vi.unstubAllEnvs();
  });

  it("reports where each value comes from", async () => {
    vi.mocked(credentialSources).mockResolvedValue({ YOUTUBE_CLIENT_ID: "env", YOUTUBE_CLIENT_SECRET: "saved" });
    const body = await (await GET(new Request("http://localhost:3000/api/connections"))).json();
    expect(body.sources).toEqual({ YOUTUBE_CLIENT_ID: "env", YOUTUBE_CLIENT_SECRET: "saved" });
  });

  it("refuses to save a value .env sets, because .env wins on the next restart", async () => {
    vi.mocked(credentialSources).mockResolvedValue({ YOUTUBE_CLIENT_ID: "env" });
    const response = await POST(new Request("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ values: { YOUTUBE_CLIENT_ID: "new-id" } })
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("set in .env");
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("no longer accepts the unused YouTube API key", async () => {
    const response = await POST(new Request("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ values: { YOUTUBE_API_KEY: "key" } })
    }));
    expect(response.status).toBe(400);
  });

  it("returns refreshed connection status after saving", async () => {
    vi.mocked(accountIdConfigured).mockImplementation(async (platform) => platform === "youtube");
    const response = await POST(new Request("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ values: { YOUTUBE_CLIENT_ID: "new-id" } })
    }));
    expect(response.status).toBe(200);
    expect(saveCredentials).toHaveBeenCalledWith({ YOUTUBE_CLIENT_ID: "new-id" });
    expect((await response.json()).connected).toEqual({ youtube: true, tiktok: false, spotify: false, linkedin: false });
  });
});
