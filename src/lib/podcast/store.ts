import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type {
  PodcastAutomation,
  PodcastEpisode, PodcastShow, PodcastState } from "@/lib/podcast/types";

const podcastRoot = dataPath("podcast");
const stateFile = path.join(podcastRoot, "show.json");

export const DEFAULT_SHOW: PodcastShow = {
  title: "CoLateral Marketing",
  description:
    "Live builds, AI agents and the business of shipping software. Every stream from the channel, in full, as audio.",
  author: "Nic",
  email: "",
  link: "https://www.youtube.com/",
  language: "en",
  category: "Technology",
  explicit: false,
  artworkUrl: "",
  copyright: `© ${new Date().getFullYear()} CoLateral Marketing`
};

let writeChain = Promise.resolve();

export const DEFAULT_PODCAST_AUTOMATION: PodcastAutomation = {
  enabled: true,
  time: "10:00",
  timeZone: "America/Toronto",
};

export async function readPodcastState(): Promise<PodcastState> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8")) as Partial<PodcastState>;
    return {
      show: { ...DEFAULT_SHOW, ...(parsed.show ?? {}) },
      episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
      automation: { ...DEFAULT_PODCAST_AUTOMATION, ...parsed.automation },
      deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { show: { ...DEFAULT_SHOW }, episodes: [],
      automation: { ...DEFAULT_PODCAST_AUTOMATION },
      deliveries: [],
    };
  }
}

export async function mutatePodcastState<T>(
  change: (state: PodcastState) => T,
): Promise<{ state: PodcastState; result: T }> {
  const write = async () => {
    const state = await readPodcastState();
    const result = change(state);
    await mkdir(podcastRoot, { recursive: true });
    const pendingFile = `${stateFile}.${process.pid}.tmp`;
    await writeFile(pendingFile, JSON.stringify(state, null, 2), "utf8");
    await rename(pendingFile, stateFile);
    return { state, result };
  };
  const result = writeChain.then(write, write);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function updateShow(patch: Partial<PodcastShow>): Promise<PodcastState> {
  return (
    await mutatePodcastState((state) => {
      state.show = { ...state.show, ...patch };
    })
  ).state;
}

/**
 * Adds the episode unless one from the same export is already in the feed.
 * Re-publishing has to be a no-op: the pipeline calls this from a poll, and a
 * duplicated guid is a duplicated episode in everyone's app.
 */
export async function addEpisode(episode: PodcastEpisode): Promise<{ state: PodcastState; added: boolean }> {
  const { state, result: added } = await mutatePodcastState((state) => {
    const existing = state.episodes.find(
    (item) => item.id === episode.id || (Boolean(episode.exportId) && item.exportId === episode.exportId)
  );
  if (existing) return false;
    state.episodes.unshift(episode);
    return true;
  });
  return { state, added };
}

export async function removeEpisode(id: string): Promise<PodcastState> {
  return (
    await mutatePodcastState((state) => {
      state.episodes = state.episodes.filter((item) => item.id !== id);
      for (const delivery of state.deliveries.filter(
        (item) => item.episodeId === id,
      )) {
        delivery.status = "cancelled";
        delete delivery.episodeId;
        delete delivery.completedAt;
      }
    })
  ).state;
}

export function episodeForExport(state: PodcastState, exportId: string): PodcastEpisode | undefined {
  return state.episodes.find((item) => item.exportId === exportId);
}
