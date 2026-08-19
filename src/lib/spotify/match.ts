import type { SpotifyEpisode } from "@/lib/spotify/api";

/**
 * An RSS episode and the Spotify episode it became carry no shared id —
 * Spotify mints its own and never tells the feed. The only durable link
 * between them is the title, so it is compared with the punctuation, casing
 * and emoji that survive a trip through two different systems removed.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['‘’"“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type MatchableEpisode = { id: string; title: string };

export function matchEpisodes(
  feedEpisodes: MatchableEpisode[],
  spotifyEpisodes: SpotifyEpisode[]
): Record<string, SpotifyEpisode> {
  const byTitle = new Map<string, SpotifyEpisode>();
  for (const episode of spotifyEpisodes) {
    const key = normalizeTitle(episode.name);
    if (key && !byTitle.has(key)) byTitle.set(key, episode);
  }

  const matches: Record<string, SpotifyEpisode> = {};
  for (const episode of feedEpisodes) {
    const key = normalizeTitle(episode.title);
    if (!key) continue;
    const exact = byTitle.get(key);
    if (exact) {
      matches[episode.id] = exact;
      continue;
    }
    // Spotify shortens a long title in some apps and the feed may carry a
    // suffix the show never had; one containing the other is still the same
    // episode, and the longest overlap wins so two similar titles cannot swap.
    let best: SpotifyEpisode | null = null;
    let bestLength = 0;
    for (const [candidateKey, candidate] of byTitle) {
      if (!candidateKey.startsWith(key) && !key.startsWith(candidateKey)) continue;
      const overlap = Math.min(candidateKey.length, key.length);
      if (overlap > bestLength) {
        best = candidate;
        bestLength = overlap;
      }
    }
    if (best && bestLength >= 8) matches[episode.id] = best;
  }
  return matches;
}
