import { stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { podcastPublicBaseUrl } from "@/lib/podcasts/config";
import { listPodcastEpisodes, podcastAudioDir } from "@/lib/podcasts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function xml(value: string) {
  return value.replace(
    /[<>&'"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character]!,
  );
}

function guid(value: string) {
  return `command-podcast-${value}`;
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  const base = podcastPublicBaseUrl() || request.nextUrl.origin;
  const episodes = (await listPodcastEpisodes()).filter((episode) => {
    if (episode.status === "published") return true;
    return (
      episode.status === "scheduled" &&
      episode.scheduledAt &&
      new Date(episode.scheduledAt).getTime() <= now
    );
  });
  const items = await Promise.all(
    episodes.map(async (episode) => {
      const length = await stat(
        path.join(podcastAudioDir(), path.basename(episode.fileName)),
      )
        .then((info) => info.size)
        .catch(() => 0);
      const published =
        episode.publishedAt || episode.scheduledAt || episode.createdAt;
      const url =
        episode.audioUrl ||
        `${base}/api/podcasts/audio?id=${encodeURIComponent(episode.id)}`;
      return `
    <item>
      <title>${xml(episode.title)}</title>
      <description>${xml(episode.description)}</description>
      <guid isPermaLink="false">${xml(guid(episode.id))}</guid>
      <pubDate>${new Date(published).toUTCString()}</pubDate>
      <enclosure url="${xml(url)}" length="${length}" type="audio/mpeg" />
      <itunes:duration>${Math.round(episode.durationSec)}</itunes:duration>
      <itunes:episodeType>full</itunes:episodeType>
    </item>`;
    }),
  );
  const title =
    process.env.PODCAST_TITLE?.trim() ||
    "Building CoLateral with Nic Vandewetering";
  const description =
    process.env.PODCAST_DESCRIPTION?.trim() ||
    "Structural engineering, AI, creator workflows and the process of building CoLateral in public.";
  const artwork = process.env.PODCAST_ARTWORK_URL?.trim();
  const ownerEmail = process.env.PODCAST_OWNER_EMAIL?.trim();
  const author = process.env.PODCAST_AUTHOR?.trim() || "Nic Vandewetering";
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(base)}</link>
    <description>${xml(description)}</description>
    <language>en-ca</language>
    <itunes:author>${xml(author)}</itunes:author>
    <itunes:explicit>false</itunes:explicit>${items.join("")}
    ${artwork ? `<itunes:image href="${xml(artwork)}" />` : ""}
    ${ownerEmail ? `<itunes:owner><itunes:name>${xml(author)}</itunes:name><itunes:email>${xml(ownerEmail)}</itunes:email></itunes:owner>` : ""}
  </channel>
</rss>`;
  return new Response(feed, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
