import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { credentialsPresent, saveCredentials } from "@/lib/publisher/credentials";
import { accountIdConfigured } from "@/lib/publisher/accounts";
import { spotifyConnected } from "@/lib/spotify/auth";

vi.mock("@/lib/publisher/credentials", () => ({
  credentialsPresent: vi.fn(),
  saveCredentials: vi.fn()
}));
vi.mock("@/lib/publisher/accounts", () => ({
  accountIdConfigured: vi.fn()
}));
vi.mock("@/lib/spotify/auth", () => ({
  spotifyConnected: vi.fn()
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
    vi.mocked(saveCredentials).mockResolvedValue();
  });

  it("keeps saved app credentials separate from completed sign-in", async () => {
    const response = await GET();
    expect(await response.json()).toMatchObject({
      present,
      connected: { youtube: false, tiktok: false, spotify: false }
    });
  });

  it("returns refreshed connection status after saving", async () => {
    vi.mocked(accountIdConfigured).mockImplementation(async (platform) => platform === "youtube");
    const response = await POST(new Request("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ values: { YOUTUBE_CLIENT_ID: "new-id" } })
    }));
    expect(response.status).toBe(200);
    expect(saveCredentials).toHaveBeenCalledWith({ YOUTUBE_CLIENT_ID: "new-id" });
    expect((await response.json()).connected).toEqual({ youtube: true, tiktok: false, spotify: false });
  });
});
