import { describe, expect, it } from "vitest";
import type { SpotifyEpisode } from "@/lib/spotify/api";
import { matchEpisodes, normalizeTitle } from "@/lib/spotify/match";

function episode(id: string, name: string): SpotifyEpisode {
  return { id, name, url: `https://open.spotify.com/episode/${id}`, releaseDate: "2026-08-01", durationSec: 3600 };
}

describe("normalizeTitle", () => {
  it("ignores casing, punctuation and smart quotes", () => {
    expect(normalizeTitle("Nic's Build — Day 12!")).toBe(normalizeTitle("nics build day 12"));
  });

  it("collapses an emoji-only difference", () => {
    expect(normalizeTitle("🔴 LIVE: shipping the agent")).toBe(normalizeTitle("LIVE shipping the agent"));
  });
});

describe("matchEpisodes", () => {
  const live = episode("sp1", "Shipping the agent, live");

  it("matches on title once punctuation is set aside", () => {
    const matches = matchEpisodes([{ id: "feed1", title: "Shipping the Agent — Live" }], [live]);
    expect(matches.feed1?.id).toBe("sp1");
  });

  it("leaves an episode Spotify has not pulled in unmatched", () => {
    const matches = matchEpisodes([{ id: "feed1", title: "Something else entirely" }], [live]);
    expect(matches.feed1).toBeUndefined();
  });

  it("matches a title Spotify truncated", () => {
    const matches = matchEpisodes(
      [{ id: "feed1", title: "Building Capital Command from scratch, part four" }],
      [episode("sp2", "Building Capital Command from scratch")]
    );
    expect(matches.feed1?.id).toBe("sp2");
  });

  it("refuses a prefix too short to mean anything", () => {
    const matches = matchEpisodes([{ id: "feed1", title: "Day 1" }], [episode("sp3", "Day 12: the long one")]);
    expect(matches.feed1).toBeUndefined();
  });

  it("picks the longer overlap when two episodes share a prefix", () => {
    const matches = matchEpisodes(
      [{ id: "feed1", title: "The pipeline rebuild, hour two" }],
      [episode("sp4", "The pipeline rebuild"), episode("sp5", "The pipeline rebuild, hour two")]
    );
    expect(matches.feed1?.id).toBe("sp5");
  });
});
