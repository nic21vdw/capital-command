import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  spotifyConfigured,
  spotifyConnected,
  spotifyProfile,
} from "@/lib/spotify/auth";
import { readPodcastState } from "@/lib/podcast/store";
import { spotifyStatus } from "@/lib/spotify/status";

vi.mock("@/lib/spotify/auth", () => ({
  spotifyConfigured: vi.fn(() => true),
  spotifyConnected: vi.fn(async () => false),
  spotifyProfile: vi.fn(async () => null),
}));
vi.mock("@/lib/spotify/api", () => ({
  getShow: vi.fn(async () => null),
  listEpisodes: vi.fn(async () => []),
}));
vi.mock("@/lib/podcast/store", () => ({
  readPodcastState: vi.fn(async () => ({ show: {}, episodes: [] })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(spotifyConfigured).mockReturnValue(true);
  vi.mocked(spotifyConnected).mockResolvedValue(false);
  vi.mocked(spotifyProfile).mockResolvedValue(null);
  vi.mocked(readPodcastState).mockResolvedValue({
    show: {},
    episodes: [],
  } as never);
});

describe("Spotify account readiness", () => {
  it("does not claim a saved token is a verified account connection", async () => {
    vi.mocked(spotifyConnected).mockResolvedValue(true);
    const result = await spotifyStatus();
    expect(spotifyProfile).toHaveBeenCalledWith(true);
    expect(result.connected).toBe(false);
    expect(result.error).toContain("could not be verified");
  });

  it("reuses and verifies an existing app connection", async () => {
    vi.mocked(spotifyConnected).mockResolvedValue(true);
    vi.mocked(spotifyProfile).mockResolvedValue({
      id: "nic",
      name: "Nic",
    } as never);
    expect(await spotifyStatus()).toMatchObject({
      connected: true,
      profile: { id: "nic" },
    });
  });

  it("keeps an absent app grant disconnected", async () => {
    expect(await spotifyStatus()).toMatchObject({
      connected: false,
      profile: null,
    });
    expect(spotifyProfile).not.toHaveBeenCalled();
  });
});
