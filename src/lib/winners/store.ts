import { atomicWriteJson, readJson } from "@/lib/storage/atomic-json";
import { dataPath } from "@/lib/paths";
import type { ExternalPost, WinnersStore } from "@/lib/winners/types";

export function winnersFile(): string {
  return dataPath("winners", "winners.json");
}

export function externalPostsFile(): string {
  return dataPath("winners", "x-posts.json");
}

export async function readWinners(): Promise<WinnersStore> {
  const stored = await readJson<WinnersStore>(winnersFile()).catch(() => null);
  if (stored && stored.version === 1 && stored.winners) return stored;
  return { version: 1, winners: {}, lastScanAt: null };
}

export async function writeWinners(store: WinnersStore): Promise<void> {
  await atomicWriteJson(winnersFile(), store);
}

export async function readExternalPosts(): Promise<ExternalPost[]> {
  const stored = await readJson<ExternalPost[]>(externalPostsFile()).catch(() => null);
  return Array.isArray(stored) ? stored.filter((post) => post && post.platform === "x" && typeof post.views === "number") : [];
}
