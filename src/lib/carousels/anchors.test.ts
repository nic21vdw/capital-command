import { describe, expect, it } from "vitest";
import {
  anchorSlides,
  matchSegmentTime,
  MIN_ANCHOR_GAP_SEC,
  parseAtSeconds,
  separateAnchors,
  slideTerms,
  spreadTargets,
  timecode,
  transcriptDigest
} from "@/lib/carousels/anchors";

const segments = [
  { start: 0, end: 10, text: "welcome back to the stream everyone" },
  { start: 10, end: 20, text: "today we are shipping the agent terminal" },
  { start: 20, end: 30, text: "claude runs inside colateral now" },
  { start: 30, end: 40, text: "it can read the structural model" },
  { start: 40, end: 50, text: "and write the calculation notes" },
  { start: 50, end: 60, text: "quick break to eat a burrito" },
  { start: 60, end: 70, text: "scrambled eggs and peanut butter wraps" },
  { start: 70, end: 80, text: "that is my whole breakfast routine" },
  { start: 80, end: 90, text: "back to the carousel renderer" },
  { start: 90, end: 100, text: "the slides export as png files" },
  { start: 100, end: 110, text: "one thousand and sixty subscribers" },
  { start: 110, end: 120, text: "thanks for following the build" }
];

describe("timecode", () => {
  it("stamps minutes and seconds", () => {
    expect(timecode(0)).toBe("00:00");
    expect(timecode(75)).toBe("01:15");
    expect(timecode(3661)).toBe("61:01");
  });
});

describe("transcriptDigest", () => {
  it("stamps every line", () => {
    expect(transcriptDigest(segments).split("\n")[1]).toBe("[00:10] today we are shipping the agent terminal");
  });

  it("thins a long transcript instead of truncating it, so the end is still there", () => {
    const long = Array.from({ length: 400 }, (_, index) => ({
      start: index * 10,
      end: index * 10 + 10,
      text: `line number ${index} with some words in it to take up room`
    }));
    const digest = transcriptDigest(long, 4000);
    expect(digest.length).toBeLessThanOrEqual(4000);
    expect(digest).toContain("[00:00]");
    // The last minutes of the recording survive — the whole point of thinning.
    expect(Number(digest.split("\n").at(-1)!.match(/\[(\d+):/)![1])).toBeGreaterThan(50);
  });

  it("is empty for an empty transcript", () => {
    expect(transcriptDigest([])).toBe("");
  });
});

describe("parseAtSeconds", () => {
  it("takes a number", () => {
    expect(parseAtSeconds(750, 4400)).toBe(750);
  });

  it("takes a number written as a string", () => {
    expect(parseAtSeconds("750s", 4400)).toBe(750);
  });

  it("rejects what is not a time", () => {
    expect(parseAtSeconds(undefined, 4400)).toBeNull();
    expect(parseAtSeconds("early on", 4400)).toBeNull();
    expect(parseAtSeconds(-5, 4400)).toBeNull();
  });

  it("rejects a second past the end of the recording", () => {
    expect(parseAtSeconds(9000, 4400)).toBeNull();
  });

  it("does not range-check when the duration is unknown", () => {
    expect(parseAtSeconds(9000, 0)).toBe(9000);
  });
});

describe("slideTerms", () => {
  it("keeps content words and drops filler", () => {
    expect(slideTerms("Really building the agent terminal 🤖")).toEqual(["building", "agent", "terminal"]);
  });
});

describe("matchSegmentTime", () => {
  it("finds the part of the recording a slide's words came from", () => {
    const seconds = matchSegmentTime("Claude lives inside the agent terminal", segments);
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeLessThan(60);
  });

  it("finds a different part for different words", () => {
    const seconds = matchSegmentTime("Breakfast is eggs and peanut butter", segments);
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeGreaterThan(50);
  });

  it("returns null when nothing in the transcript matches", () => {
    expect(matchSegmentTime("mortgage refinancing paperwork", segments)).toBeNull();
  });
});

describe("separateAnchors", () => {
  it("pushes a duplicate anchor forward so two slides never share a shot", () => {
    const times = separateAnchors([100, 100, 105], 4400);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(MIN_ANCHOR_GAP_SEC);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(MIN_ANCHOR_GAP_SEC);
  });

  it("leaves anchors that are already apart alone", () => {
    expect(separateAnchors([100, 900, 2000], 4400)).toEqual([100, 900, 2000]);
  });

  it("never runs past the end of the recording", () => {
    expect(separateAnchors([4399, 4399, 4399], 4400).every((time) => time <= 4399)).toBe(true);
  });
});

describe("anchorSlides", () => {
  it("trusts the second the model gave", () => {
    const anchors = anchorSlides({
      slides: [{ heading: "Agent terminal", body: "", atSeconds: 15 }],
      segments,
      durationSec: 120
    });
    expect(anchors[0]).toEqual({ seconds: 15, from: "model" });
  });

  it("matches the slide's own words when the model left the second out", () => {
    const anchors = anchorSlides({
      slides: [{ heading: "Breakfast burrito", body: "Scrambled eggs and peanut butter" }],
      segments,
      durationSec: 120
    });
    expect(anchors[0].from).toBe("transcript");
    expect(anchors[0].seconds).toBeGreaterThan(50);
  });

  it("falls back to the slide's place in the deck when nothing matches", () => {
    const anchors = anchorSlides({
      slides: [{ heading: "Follow for more", body: "New videos every week" }],
      segments,
      durationSec: 120
    });
    expect(anchors[0].from).toBe("spread");
  });

  it("ignores a second the model invented past the end of the recording", () => {
    const anchors = anchorSlides({
      slides: [{ heading: "Agent terminal", body: "claude runs inside colateral", atSeconds: 99999 }],
      segments,
      durationSec: 120
    });
    expect(anchors[0].from).not.toBe("model");
  });

  it("keeps every slide's anchor apart", () => {
    const anchors = anchorSlides({
      slides: [
        { heading: "One", body: "", atSeconds: 40 },
        { heading: "Two", body: "", atSeconds: 40 },
        { heading: "Three", body: "", atSeconds: 41 }
      ],
      segments,
      durationSec: 300
    });
    const seconds = anchors.map((anchor) => anchor.seconds);
    expect(new Set(seconds).size).toBe(3);
  });
});

describe("spreadTargets", () => {
  it("leaves out the title card and the goodbye", () => {
    const targets = spreadTargets(1000, 4);
    expect(targets[0]).toBeGreaterThan(50);
    expect(targets.at(-1)!).toBeLessThan(950);
  });

  it("is empty for a video with no length", () => {
    expect(spreadTargets(0, 4)).toEqual([]);
  });
});
