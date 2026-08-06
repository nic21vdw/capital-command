import type { PodcastEpisode, PodcastShow } from "@/lib/podcast/types";

// Everything Spotify judges the show on is decided here, and none of it needs
// the network — a feed Spotify rejects is the expensive failure (the listing
// goes into a manual review queue), so the rules live in one pure file that the
// tests can hold to account.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * RFC-2822 in UTC. Built by hand rather than with `toUTCString` so the day and
 * month names can never come back localized on a machine that isn't en-US.
 */
export function rfc2822(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Description text with the markup Spotify strips anyway taken out first. */
function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]&gt;")}]]>`;
}

/**
 * What Spotify will reject the feed for, in the words the person fixing it
 * needs. Empty means the feed is submittable — not that Spotify has accepted
 * it, only that nothing here is knowably wrong.
 */
export function feedProblems(show: PodcastShow, episodes: PodcastEpisode[]): string[] {
  const problems: string[] = [];
  if (!show.title.trim()) problems.push("The show needs a title.");
  if (!show.description.trim()) problems.push("The show needs a description.");
  if (!show.author.trim()) problems.push("The show needs an author name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(show.email.trim())) {
    problems.push("The show needs a valid email address — Spotify sends the ownership verification there.");
  }
  if (!/^https:\/\//i.test(show.artworkUrl.trim())) {
    problems.push("Cover art must be a public HTTPS URL to a square image between 1400px and 3000px.");
  }
  if (!show.category.trim()) problems.push("The show needs a category.");
  if (episodes.length === 0) problems.push("Spotify will not accept a feed with no published episodes yet.");
  const offHost = episodes.filter((episode) => !/^https:\/\//i.test(episode.audioUrl));
  if (offHost.length > 0) {
    problems.push(`${offHost.length} episode file${offHost.length === 1 ? " is" : "s are"} not on a public HTTPS URL.`);
  }
  return problems;
}

export function buildFeedXml(show: PodcastShow, episodes: PodcastEpisode[], feedUrl: string): string {
  // Newest first: Spotify reads the feed top-down and shows it that way.
  const ordered = [...episodes].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const explicit = show.explicit ? "true" : "false";

  const items = ordered
    .map((episode) => {
      const summary = plainText(episode.description);
      return [
        "    <item>",
        `      <title>${escapeXml(episode.title)}</title>`,
        `      <description>${cdata(summary)}</description>`,
        `      <itunes:summary>${cdata(summary)}</itunes:summary>`,
        `      <content:encoded>${cdata(summary)}</content:encoded>`,
        `      <enclosure url="${escapeXml(episode.audioUrl)}" length="${Math.max(0, Math.round(episode.bytes))}" type="audio/mpeg"/>`,
        `      <guid isPermaLink="false">${escapeXml(episode.id)}</guid>`,
        `      <pubDate>${rfc2822(episode.publishedAt)}</pubDate>`,
        `      <itunes:duration>${formatDuration(episode.durationSec)}</itunes:duration>`,
        `      <itunes:explicit>${explicit}</itunes:explicit>`,
        `      <itunes:episodeType>full</itunes:episodeType>`,
        episode.link ? `      <link>${escapeXml(episode.link)}</link>` : null,
        "    </item>"
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"',
    '     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"',
    '     xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    '     xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(show.title)}</title>`,
    `    <description>${cdata(plainText(show.description))}</description>`,
    `    <itunes:summary>${cdata(plainText(show.description))}</itunes:summary>`,
    `    <link>${escapeXml(show.link)}</link>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <language>${escapeXml(show.language)}</language>`,
    `    <copyright>${escapeXml(show.copyright)}</copyright>`,
    `    <itunes:author>${escapeXml(show.author)}</itunes:author>`,
    `    <itunes:type>episodic</itunes:type>`,
    `    <itunes:explicit>${explicit}</itunes:explicit>`,
    `    <itunes:image href="${escapeXml(show.artworkUrl)}"/>`,
    `    <itunes:category text="${escapeXml(show.category)}"/>`,
    "    <itunes:owner>",
    `      <itunes:name>${escapeXml(show.author)}</itunes:name>`,
    `      <itunes:email>${escapeXml(show.email)}</itunes:email>`,
    "    </itunes:owner>",
    items,
    "  </channel>",
    "</rss>"
  ]
    .filter((line) => line.length > 0)
    .join("\n")
    .concat("\n");
}
