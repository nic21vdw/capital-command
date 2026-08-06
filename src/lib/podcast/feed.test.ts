import { describe, expect, it } from "vitest";
import { buildFeedXml, feedProblems, formatDuration, rfc2822 } from "@/lib/podcast/feed";
import type { PodcastEpisode, PodcastShow } from "@/lib/podcast/types";

const show: PodcastShow = {
  title: "Capital Command",
  description: "Live builds & AI agents",
  author: "Nic",
  email: "nic@example.com",
  link: "https://youtube.com/@capitalcommand",
  language: "en",
  category: "Technology",
  explicit: false,
  artworkUrl: "https://cdn.example.com/podcast/cover.jpg",
  copyright: "© 2026 Capital Command"
};

function episode(overrides: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: "ep-1",
    title: "Building an agent team",
    description: "How the orchestrator reconciles the specialists.",
    audioUrl: "https://cdn.example.com/podcast/episodes/ep-1.mp3",
    audioKey: "podcast/episodes/ep-1.mp3",
    bytes: 48_000_000,
    durationSec: 3725,
    publishedAt: "2026-08-01T09:30:00.000Z",
    ...overrides
  };
}

const FEED_URL = "https://cdn.example.com/podcast/feed.xml";

describe("rfc2822", () => {
  it("formats in UTC with English day and month names", () => {
    expect(rfc2822("2026-08-01T09:30:00.000Z")).toBe("Sat, 01 Aug 2026 09:30:00 +0000");
  });
});

describe("formatDuration", () => {
  it("pads to HH:MM:SS", () => {
    expect(formatDuration(3725)).toBe("01:02:05");
    expect(formatDuration(9)).toBe("00:00:09");
  });
});

describe("buildFeedXml", () => {
  it("carries the tags Spotify needs to accept and verify the show", () => {
    const xml = buildFeedXml(show, [episode()], FEED_URL);
    expect(xml).toContain("<itunes:email>nic@example.com</itunes:email>");
    expect(xml).toContain('<itunes:image href="https://cdn.example.com/podcast/cover.jpg"/>');
    expect(xml).toContain('<itunes:category text="Technology"/>');
    expect(xml).toContain(`<atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>`);
    expect(xml).toContain('<enclosure url="https://cdn.example.com/podcast/episodes/ep-1.mp3" length="48000000" type="audio/mpeg"/>');
    expect(xml).toContain('<guid isPermaLink="false">ep-1</guid>');
    expect(xml).toContain("<itunes:duration>01:02:05</itunes:duration>");
  });

  it("orders episodes newest first whatever order they were added in", () => {
    const xml = buildFeedXml(show, [
      episode({ id: "old", publishedAt: "2026-07-01T09:00:00.000Z" }),
      episode({ id: "new", publishedAt: "2026-08-01T09:00:00.000Z" })
    ], FEED_URL);
    expect(xml.indexOf("<guid isPermaLink=\"false\">new</guid>")).toBeLessThan(
      xml.indexOf("<guid isPermaLink=\"false\">old</guid>")
    );
  });

  it("escapes titles that would otherwise break the XML", () => {
    const xml = buildFeedXml(show, [episode({ title: 'Claude & "agents" <live>' })], FEED_URL);
    expect(xml).toContain("<title>Claude &amp; &quot;agents&quot; &lt;live&gt;</title>");
  });

  it("keeps a description containing a CDATA terminator from ending the block early", () => {
    const xml = buildFeedXml(show, [episode({ description: "before ]]> after" })], FEED_URL);
    expect(xml).not.toContain("before ]]> after");
    expect(xml).toContain("before ]]&gt; after");
  });

  it("stays well-formed with no episodes", () => {
    const xml = buildFeedXml(show, [], FEED_URL);
    expect(xml).toContain("</channel>");
    expect(xml).not.toContain("<item>");
  });
});

describe("feedProblems", () => {
  it("passes a complete show", () => {
    expect(feedProblems(show, [episode()])).toEqual([]);
  });

  it("names the ownership email, because Spotify verifies through it", () => {
    expect(feedProblems({ ...show, email: "" }, [episode()]).join(" ")).toContain("verification");
  });

  it("rejects artwork that is not on public HTTPS", () => {
    expect(feedProblems({ ...show, artworkUrl: "http://cdn.example.com/c.jpg" }, [episode()]).join(" ")).toContain("HTTPS");
  });

  it("refuses an empty show — Spotify will not accept a feed with no episodes", () => {
    expect(feedProblems(show, []).join(" ")).toContain("no published episodes");
  });

  it("flags an episode whose audio is not publicly reachable", () => {
    const problems = feedProblems(show, [episode({ audioUrl: "file:///C:/clips/ep-1.mp3" })]);
    expect(problems.join(" ")).toContain("not on a public HTTPS URL");
  });
});
