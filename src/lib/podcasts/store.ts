import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PodcastEpisode, PodcastLibrary } from "@/lib/podcasts/types";

const podcastsRoot = path.join(process.cwd(), "data", "podcasts");
const libraryFile = path.join(podcastsRoot, "episodes.json");
let writeQueue = Promise.resolve();

const EMPTY_LIBRARY: PodcastLibrary = { version: 1, episodes: [] };

export function podcastAudioDir() {
  return path.join(podcastsRoot, "audio");
}

export async function readPodcastLibrary(): Promise<PodcastLibrary> {
  try {
    const parsed = JSON.parse(await readFile(libraryFile, "utf8")) as Partial<PodcastLibrary>;
    return {
      version: 1,
      episodes: Array.isArray(parsed.episodes) ? parsed.episodes : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // A malformed local library should not take down the rest of Command.
      return EMPTY_LIBRARY;
    }
    return EMPTY_LIBRARY;
  }
}

export async function writePodcastLibrary(library: PodcastLibrary) {
  const write = async () => {
    await mkdir(podcastsRoot, { recursive: true });
    const tmp = `${libraryFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, episodes: library.episodes }, null, 2), "utf8");
    await rename(tmp, libraryFile);
  };
  writeQueue = writeQueue.then(write, write);
  await writeQueue;
}

export async function listPodcastEpisodes(): Promise<PodcastEpisode[]> {
  const library = await readPodcastLibrary();
  return [...library.episodes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function upsertPodcastEpisodes(episodes: PodcastEpisode[]) {
  const library = await readPodcastLibrary();
  const byId = new Map(library.episodes.map((episode) => [episode.id, episode]));
  for (const episode of episodes) byId.set(episode.id, episode);
  library.episodes = [...byId.values()];
  await writePodcastLibrary(library);
  return episodes;
}

export async function updatePodcastEpisode(
  id: string,
  patch: Partial<Pick<PodcastEpisode, "title" | "description" | "destinations" | "scheduledAt" | "status" | "publishedAt">>
) {
  const library = await readPodcastLibrary();
  const episode = library.episodes.find((candidate) => candidate.id === id);
  if (!episode) return undefined;
  Object.assign(episode, patch, { updatedAt: new Date().toISOString() });
  await writePodcastLibrary(library);
  return episode;
}

export async function getPodcastEpisode(id: string) {
  const library = await readPodcastLibrary();
  return library.episodes.find((episode) => episode.id === id);
}

