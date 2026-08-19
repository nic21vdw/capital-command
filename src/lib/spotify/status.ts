import { readPodcastState } from "@/lib/podcast/store";
import { spotifyConfigured, spotifyConnected, spotifyProfile, type SpotifyProfile } from "@/lib/spotify/auth";
import { getShow, listEpisodes, type SpotifyEpisode, type SpotifyShow } from "@/lib/spotify/api";
import { matchEpisodes } from "@/lib/spotify/match";

export type SpotifyStatus = {
  configured: boolean;
  connected: boolean;
  profile: SpotifyProfile | null;
  show: SpotifyShow | null;
  showId: string | null;
  /** Feed episode id → the Spotify episode it turned into, when it is live. */
  live: Record<string, SpotifyEpisode>;
  /** Feed episodes Spotify has not pulled in yet. */
  pending: { id: string; title: string; publishedAt: string }[];
  error: string | null;
};

/**
 * What Spotify itself says about the show, which is the only honest answer to
 * "did that episode go out". The feed says what was offered; Spotify decides
 * when it pulls, and it can be hours.
 */
export async function spotifyStatus(): Promise<SpotifyStatus> {
  const configured = spotifyConfigured();
  const connected = configured ? await spotifyConnected() : false;
  const state = await readPodcastState();
  const showId = state.show.spotifyShowId?.trim() || null;
  const base: SpotifyStatus = {
    configured,
    connected,
    profile: null,
    show: null,
    showId,
    live: {},
    pending: [],
    error: null
  };
  if (!configured) return base;

  base.profile = connected ? await spotifyProfile().catch(() => null) : null;
  if (!showId) return base;

  try {
    base.show = await getShow(showId);
    const episodes = await listEpisodes(showId);
    base.live = matchEpisodes(
      state.episodes.map((episode) => ({ id: episode.id, title: episode.title })),
      episodes
    );
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
    return base;
  }

  base.pending = state.episodes
    .filter((episode) => !base.live[episode.id])
    .map((episode) => ({ id: episode.id, title: episode.title, publishedAt: episode.publishedAt }));
  return base;
}
