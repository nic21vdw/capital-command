import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { publishEpisode } from "@/lib/podcast/publish";
import {
  DEFAULT_SHOW,
  mutatePodcastState,
  readPodcastState,
} from "@/lib/podcast/store";

const host = vi.hoisted(() => ({
  upload: vi.fn(async () => "key"),
  publicUrl: vi.fn(async (key: string) => `https://cdn.example.com/${key}`),
  putObjectText: vi.fn(async () => undefined),
}));
vi.mock("@/lib/publisher/config", () => ({
  hostingConfigured: () => true,
  publisherConfig: () => ({ s3: { publicBaseUrl: "https://cdn.example.com" } }),
}));
vi.mock("@/lib/publisher/hosting", () => ({ mediaHost: () => host }));
vi.mock("@/lib/automations/store", () => ({
  isAutomationPaused: async () => false,
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await mutatePodcastState((state) => {
    state.show = {
      ...DEFAULT_SHOW,
      email: "owner@example.com",
      artworkUrl: "https://cdn.example.com/art.jpg",
    };
    state.episodes = [];
    state.deliveries = [];
  });
});

describe("podcast publication recovery", () => {
  it("retries a failed feed write using the saved episode without another upload", async () => {
    const filePath = dataPath("podcast", "fixture.mp3");
    await writeFile(filePath, "mp3 fixture");
    const input = {
      filePath,
      title: "Episode",
      description: "Notes",
      durationSec: 20,
      exportId: "export-1",
    };
    host.putObjectText.mockRejectedValueOnce(new Error("Feed write failed"));
    await expect(publishEpisode(input)).rejects.toThrow("Feed write failed");
    const saved = (await readPodcastState()).episodes[0];
    expect(saved).toBeTruthy();
    const recovered = await publishEpisode(input);
    expect(recovered.episode.id).toBe(saved.id);
    expect(recovered.added).toBe(false);
    expect(host.upload).toHaveBeenCalledTimes(1);
    expect(host.putObjectText).toHaveBeenCalledTimes(2);
    expect((await readPodcastState()).episodes).toHaveLength(1);
  });

  it("serializes simultaneous attempts for the same export", async () => {
    const filePath = dataPath("podcast", "fixture.mp3");
    await writeFile(filePath, "mp3 fixture");
    const input = {
      filePath,
      title: "Episode",
      description: "Notes",
      durationSec: 20,
      exportId: "export-2",
    };
    const [first, second] = await Promise.all([
      publishEpisode(input),
      publishEpisode(input),
    ]);
    expect(first.episode.id).toBe(second.episode.id);
    expect(host.upload).toHaveBeenCalledTimes(1);
    expect((await readPodcastState()).episodes).toHaveLength(1);
  });
});
