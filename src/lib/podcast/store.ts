import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { PodcastEpisode, PodcastShow, PodcastState } from "@/lib/podcast/types";

const podcastRoot = dataPath("podcast");
const stateFile = path.join(podcastRoot, "show.json");

export const DEFAULT_SHOW: PodcastShow = {
  title: "Capital Command",
  description:
    "Live builds, AI agents and the business of shipping software. Every stream from the channel, in full, as audio.",
  author: "Nic",
  email: "",
  link: "https://www.youtube.com/",
  language: "en",
  category: "Technology",
  explicit: false,
  artworkUrl: "",
  copyright: `© ${new Date().getFullYear()} Capital Command`
};

let writeChain = Promise.resolve();

export async function readPodcastState(): Promise<PodcastState> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8")) as Partial<PodcastState>;
    return {
      show: { ...DEFAULT_SHOW, ...(parsed.show ?? {}) },
      episodes: Array.isArray(parsed.episodes) ? parsed.episodes : []
    };
  } catch {
    return { show: { ...DEFAULT_SHOW }, episodes: [] };
  }
}

async function writeState(state: PodcastState) {
  const write = async () => {
    await mkdir(podcastRoot, { recursive: true });
    await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
  };
  writeChain = writeChain.then(write, write);
  await writeChain;
}

export async function updateShow(patch: Partial<PodcastShow>): Promise<PodcastState> {
  const state = await readPodcastState();
  const next: PodcastState = { ...state, show: { ...state.show, ...patch } };
  await writeState(next);
  return next;
}

/**
 * Adds the episode unless one from the same export is already in the feed.
 * Re-publishing has to be a no-op: the pipeline calls this from a poll, and a
 * duplicated guid is a duplicated episode in everyone's app.
 */
export async function addEpisode(episode: PodcastEpisode): Promise<{ state: PodcastState; added: boolean }> {
  const state = await readPodcastState();
  const existing = state.episodes.find(
    (item) => item.id === episode.id || (Boolean(episode.exportId) && item.exportId === episode.exportId)
  );
  if (existing) return { state, added: false };
  const next: PodcastState = { ...state, episodes: [episode, ...state.episodes] };
  await writeState(next);
  return { state: next, added: true };
}

export async function removeEpisode(id: string): Promise<PodcastState> {
  const state = await readPodcastState();
  const next: PodcastState = { ...state, episodes: state.episodes.filter((item) => item.id !== id) };
  await writeState(next);
  return next;
}

export function episodeForExport(state: PodcastState, exportId: string): PodcastEpisode | undefined {
  return state.episodes.find((item) => item.exportId === exportId);
}
