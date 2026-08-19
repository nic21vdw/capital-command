import { fetchJson } from "@/lib/publisher/http";
import { spotifyAppToken, spotifyProfile, spotifyUserToken } from "@/lib/spotify/auth";

const API = "https://api.spotify.com/v1";

export type SpotifyShow = {
  id: string;
  name: string;
  publisher: string;
  description: string;
  url: string;
  image: string | null;
  totalEpisodes: number;
};

export type SpotifyEpisode = {
  id: string;
  name: string;
  url: string;
  releaseDate: string;
  durationSec: number;
};

/**
 * The connected account's token when there is one, the app's own token when
 * there is not. Every call in here is a read, so either identity answers it —
 * which is what keeps the Podcast page useful before anyone has connected.
 */
async function token(): Promise<string | null> {
  return (await spotifyUserToken().catch(() => null)) ?? (await spotifyAppToken().catch(() => null));
}

async function market(): Promise<string> {
  const profile = await spotifyProfile().catch(() => null);
  return profile?.country ?? "CA";
}

async function get<T>(path: string, label: string): Promise<T | null> {
  const accessToken = await token();
  if (!accessToken) return null;
  return fetchJson<T>(`${API}${path}`, {
    label,
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

/** Accepts a show id, a spotify:show: URI or an open.spotify.com link. */
export function parseShowId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const uri = value.match(/^spotify:show:([A-Za-z0-9]+)$/);
  if (uri) return uri[1];
  const link = value.match(/open\.spotify\.com\/(?:[a-z-]+\/)?show\/([A-Za-z0-9]+)/);
  if (link) return link[1];
  return /^[A-Za-z0-9]{16,}$/.test(value) ? value : null;
}

type ShowPayload = {
  id: string;
  name: string;
  publisher?: string;
  description?: string;
  total_episodes?: number;
  external_urls?: { spotify?: string };
  images?: { url: string }[];
};

function toShow(payload: ShowPayload): SpotifyShow {
  return {
    id: payload.id,
    name: payload.name,
    publisher: payload.publisher ?? "",
    description: payload.description ?? "",
    url: payload.external_urls?.spotify ?? `https://open.spotify.com/show/${payload.id}`,
    image: payload.images?.[0]?.url ?? null,
    totalEpisodes: payload.total_episodes ?? 0
  };
}

export async function getShow(showId: string): Promise<SpotifyShow | null> {
  const data = await get<ShowPayload>(`/shows/${showId}?market=${await market()}`, "Spotify show lookup");
  return data ? toShow(data) : null;
}

export async function searchShows(query: string, limit = 10): Promise<SpotifyShow[]> {
  const params = new URLSearchParams({ q: query, type: "show", limit: String(limit), market: await market() });
  const data = await get<{ shows?: { items?: (ShowPayload | null)[] } }>(
    `/search?${params.toString()}`,
    "Spotify show search"
  );
  return (data?.shows?.items ?? []).filter((item): item is ShowPayload => Boolean(item)).map(toShow);
}

/**
 * Every episode Spotify currently lists for the show, newest first. Paged to
 * the API maximum because the check is "is this episode there yet", and an
 * episode that fell off the first page is still an answer.
 */
export async function listEpisodes(showId: string, max = 200): Promise<SpotifyEpisode[]> {
  const episodes: SpotifyEpisode[] = [];
  const marketCode = await market();
  for (let offset = 0; offset < max; offset += 50) {
    const data = await get<{
      items?: ({ id: string; name: string; release_date?: string; duration_ms?: number; external_urls?: { spotify?: string } } | null)[];
      next?: string | null;
    }>(`/shows/${showId}/episodes?limit=50&offset=${offset}&market=${marketCode}`, "Spotify episode list");
    const items = data?.items ?? [];
    for (const item of items) {
      if (!item) continue;
      episodes.push({
        id: item.id,
        name: item.name,
        url: item.external_urls?.spotify ?? `https://open.spotify.com/episode/${item.id}`,
        releaseDate: item.release_date ?? "",
        durationSec: Math.round((item.duration_ms ?? 0) / 1000)
      });
    }
    if (!data?.next) break;
  }
  return episodes;
}
