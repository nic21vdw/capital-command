import { stat } from "node:fs/promises";
import { buildFeedXml, feedProblems } from "@/lib/podcast/feed";
import { addEpisode, readPodcastState } from "@/lib/podcast/store";
import type { PodcastEpisode, PodcastState } from "@/lib/podcast/types";
import { hostingConfigured, publisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";

export const FEED_KEY = "podcast/feed.xml";

/**
 * The feed must live at a URL that never changes and never expires — Spotify
 * re-reads it for the life of the show. That rules out presigned URLs, so a
 * public base URL is required here even though the rest of the media hosting
 * works without one.
 */
export function podcastConfigured(config = publisherConfig()): boolean {
  return hostingConfigured(config) && Boolean(config.s3.publicBaseUrl);
}

export function feedUrl(config = publisherConfig()): string | null {
  const base = config.s3.publicBaseUrl?.replace(/\/+$/, "");
  return base ? `${base}/${FEED_KEY}` : null;
}

function requireHost() {
  const config = publisherConfig();
  if (!podcastConfigured(config)) {
    throw new Error(
      "The podcast feed needs a permanent public URL. Turn on public access for the R2 bucket (Cloudflare dashboard → R2 → the bucket → Settings → Public Development URL, or attach a custom domain) and paste that address into Public address of the bucket on the Podcast page."
    );
  }
  const host = mediaHost(config);
  if (!host) throw new Error("Media hosting is configured but could not be created.");
  return { host, config };
}

/** Rewrites feed.xml from the current state. Safe to call as often as you like. */
export async function refreshFeed(state?: PodcastState): Promise<{ url: string; problems: string[] }> {
  const { host, config } = requireHost();
  const current = state ?? (await readPodcastState());
  const url = feedUrl(config)!;
  const problems = feedProblems(current.show, current.episodes);
  await host.putObjectText(FEED_KEY, buildFeedXml(current.show, current.episodes, url), "application/rss+xml");
  return { url, problems };
}

export type NewEpisode = {
  /** Local path to the MP3 the pipeline cut from the finished edit. */
  filePath: string;
  title: string;
  description: string;
  durationSec: number;
  publishedAt?: string;
  runId?: string;
  projectId?: string;
  exportId?: string;
  link?: string;
};

/**
 * Uploads one MP3 to the media host and adds it to the feed. Idempotent by
 * export id, because the pipeline calls this from a poll that runs every few
 * seconds — the upload only happens for an episode the feed does not have.
 */
export async function publishEpisode(input: NewEpisode): Promise<{ episode: PodcastEpisode; added: boolean; url: string }> {
  const { host } = requireHost();
  const state = await readPodcastState();
  const existing = input.exportId
    ? state.episodes.find((item) => item.exportId === input.exportId)
    : undefined;
  if (existing) {
    const { url } = await refreshFeed(state);
    return { episode: existing, added: false, url };
  }

  const info = await stat(input.filePath);
  const id = crypto.randomUUID();
  const key = `podcast/episodes/${id}.mp3`;
  await host.upload(input.filePath, key);

  const episode: PodcastEpisode = {
    id,
    title: input.title,
    description: input.description,
    audioUrl: await host.publicUrl(key),
    audioKey: key,
    bytes: info.size,
    durationSec: input.durationSec,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    runId: input.runId,
    projectId: input.projectId,
    exportId: input.exportId,
    link: input.link
  };

  const { state: next, added } = await addEpisode(episode);
  const { url } = await refreshFeed(next);
  return { episode, added, url };
}
