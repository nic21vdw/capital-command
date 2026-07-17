import { describe, expect, it } from "vitest";
import {
  buildAss,
  buildWatermarkDialogue,
  chunkWords,
  formatSrtTime,
  formatVttTime,
  mergeSegments,
  parseSubtitleWords,
  parseSubtitles,
  parseTimestamp,
  serializeSrt,
  serializeVtt,
  splitSegment,
  windowSegments
} from "./captions";
import { defaultCaptionStyle } from "@/lib/storage/schemas";
import type { CaptionSegment } from "@/types/domain";

const seg = (id: string, start: number, end: number, text: string): CaptionSegment => ({
  id,
  start,
  end,
  text,
  words: text.split(" ").map((t, i) => ({ text: t, start: start + i, end: start + i + 1 })),
  enabled: true
});

describe("parseTimestamp", () => {
  it("reads HH:MM:SS.mmm and MM:SS.mmm", () => {
    expect(parseTimestamp("00:00:02.500")).toBeCloseTo(2.5);
    expect(parseTimestamp("01:02:03.000")).toBeCloseTo(3723);
    expect(parseTimestamp("00:05.000")).toBeCloseTo(5);
  });
});

describe("time formatting", () => {
  it("formats SRT with comma and VTT with dot", () => {
    expect(formatSrtTime(3723.25)).toBe("01:02:03,250");
    expect(formatVttTime(3723.25)).toBe("01:02:03.250");
  });
});

describe("parseSubtitleWords", () => {
  it("recovers word-level timing from YouTube-style inline timestamps", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "<00:00:00.300><c> Hello</c><00:00:00.900><c> brave</c><00:00:01.400><c> world</c>",
      ""
    ].join("\n");
    const words = parseSubtitleWords(vtt);
    expect(words.map((w) => w.text)).toEqual(["Hello", "brave", "world"]);
    expect(words[0].start).toBeCloseTo(0.3);
    expect(words[1].start).toBeCloseTo(0.9);
    // ends close against the following word's start
    expect(words[0].end).toBeCloseTo(0.9);
  });

  it("dedupes rolling cues that repeat the same word at the same time", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:01.000",
      "<00:00:00.300><c> hello</c>",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "<00:00:00.300><c> hello</c><00:00:01.300><c> there</c>",
      ""
    ].join("\n");
    const words = parseSubtitleWords(vtt);
    expect(words.map((w) => w.text)).toEqual(["hello", "there"]);
  });

  it("decodes HTML entities instead of leaking them into caption text", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "<00:00:00.300><c> Tom</c><00:00:00.900><c> &amp;</c><00:00:01.200><c> Jerry&#39;s</c><00:00:01.500><c> &quot;show&quot;</c>",
      ""
    ].join("\n");
    const words = parseSubtitleWords(vtt);
    expect(words.map((w) => w.text)).toEqual(["Tom", "&", "Jerry's", '"show"']);
  });

  it("drops speaker-change chevrons (>> arrives as &gt;&gt;) and sound tags", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "&gt;&gt; Hello there",
      "",
      "00:00:02.000 --> 00:00:04.000",
      "[Music]",
      "",
      "00:00:04.000 --> 00:00:06.000",
      "&gt;&gt;Bob: it's [ __ ] great [Applause]",
      ""
    ].join("\n");
    const words = parseSubtitleWords(vtt);
    expect(words.map((w) => w.text)).toEqual(["Hello", "there", "Bob:", "it's", "great"]);
  });

  it("spreads plain cues without inline timing across their duration", () => {
    const srt = ["1", "00:00:00,000 --> 00:00:04,000", "one two three four", ""].join("\n");
    const words = parseSubtitleWords(srt);
    expect(words.map((w) => w.text)).toEqual(["one", "two", "three", "four"]);
    expect(words[0].start).toBeCloseTo(0);
    expect(words[1].start).toBeCloseTo(1);
  });
});

describe("chunkWords / parseSubtitles", () => {
  it("breaks on sentence punctuation and max word count", () => {
    const words = "a b c. d e f g h i".split(" ").map((t, i) => ({ text: t, start: i, end: i + 1 }));
    const segs = chunkWords(words, 7);
    expect(segs[0].text).toBe("a b c.");
    expect(segs.length).toBeGreaterThan(1);
  });

  it("never lets one segment overlap the next (no stale, frozen captions)", () => {
    // Word 3's end runs long, past where the next phrase begins. The chunker must
    // trim the first segment so only one caption is ever active at a given time.
    const words = [
      { text: "one", start: 0, end: 0.5 },
      { text: "two.", start: 0.5, end: 1 },
      { text: "three", start: 1.1, end: 4 }, // inflated end that overruns the next phrase
      { text: "four", start: 1.6, end: 2 },
      { text: "five.", start: 2, end: 2.5 }
    ];
    const segs = chunkWords(words, 3);
    expect(segs.length).toBeGreaterThan(1);
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segs[i].end).toBeLessThanOrEqual(segs[i + 1].start + 1e-9);
    }
    // At any time exactly one segment is active.
    const activeAt = (t: number) => segs.filter((s) => t >= s.start && t < s.end).length;
    expect(activeAt(1.8)).toBeLessThanOrEqual(1);
  });

  it("produces segments with monotonic timing", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:03.000",
      "<00:00:00.100><c> one</c><00:00:01.000><c> two.</c><00:00:02.000><c> three</c>",
      ""
    ].join("\n");
    const segs = parseSubtitles(vtt, 7);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs[0].end).toBeGreaterThan(segs[0].start);
  });
});

describe("windowSegments", () => {
  it("shifts to clip-local time and drops out-of-range segments", () => {
    const segs = [seg("a", 5, 8, "hello world"), seg("b", 20, 23, "later text")];
    const windowed = windowSegments(segs, 4, 10);
    expect(windowed).toHaveLength(1);
    expect(windowed[0].start).toBeCloseTo(1);
    expect(windowed[0].end).toBeCloseTo(4);
  });
});

describe("split / merge", () => {
  it("splits a segment at a time into two", () => {
    const [left, right] = splitSegment(seg("a", 0, 6, "one two three four five six"), 3);
    expect(left.end).toBeCloseTo(3);
    expect(right.start).toBeCloseTo(3);
    expect(left.text.length).toBeGreaterThan(0);
    expect(right.text.length).toBeGreaterThan(0);
  });

  it("merges two segments preserving the earliest start and latest end", () => {
    const merged = mergeSegments(seg("a", 0, 2, "hello"), seg("b", 2, 5, "world there"));
    expect(merged.start).toBeCloseTo(0);
    expect(merged.end).toBeCloseTo(5);
    expect(merged.text).toBe("hello world there");
  });
});

describe("serialization", () => {
  const segs = [seg("a", 0, 2, "hello world"), { ...seg("b", 2, 4, "skip me"), enabled: false }];

  it("serializes enabled segments to SRT", () => {
    const srt = serializeSrt(segs);
    expect(srt).toContain("00:00:00,000 --> 00:00:02,000");
    expect(srt).toContain("hello world");
    expect(srt).not.toContain("skip me");
  });

  it("serializes enabled segments to VTT", () => {
    const vtt = serializeVtt(segs);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:02.000");
  });
});

describe("buildAss", () => {
  it("emits a valid ASS document with a styled Default and dialogue events", () => {
    const ass = buildAss([seg("a", 0, 2, "hello world")], defaultCaptionStyle, 1080, 1920, false);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Style: Default");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00");
    expect(ass).toContain("hello world");
  });

  it("emits one dialogue event per spoken word with the active word highlighted", () => {
    const ass = buildAss([seg("a", 0, 2, "hello world")], defaultCaptionStyle, 1080, 1920, true);
    const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue: 0,"));
    // Two words -> two events covering the phrase, each showing the full text.
    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]).toContain("hello");
    expect(dialogues[0]).toContain("world");
    // The active word is re-colored with the highlight colour and popped.
    expect(dialogues[0]).toContain("\\1c");
    expect(dialogues[0]).toContain("\\fscx112");
    // The first event starts at the segment start, the second at word 2.
    expect(dialogues[0]).toMatch(/^Dialogue: 0,0:00:00\.00,0:00:01\.00/);
    expect(dialogues[1]).toMatch(/^Dialogue: 0,0:00:01\.00,0:00:02\.00/);
  });

  it("keeps spoken words lit and dims upcoming ones in karaoke mode", () => {
    const ass = buildAss(
      [seg("a", 0, 3, "one two three")],
      { ...defaultCaptionStyle, animation: "karaoke" },
      1080,
      1920,
      true
    );
    const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue: 0,"));
    expect(dialogues).toHaveLength(3);
    // Middle event: word 1 spoken (highlight), word 3 upcoming (dimmed alpha).
    expect(dialogues[1]).toContain("\\alpha&H70&");
    expect((dialogues[1].match(/\\1c/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("wraps lines every wordsPerLine words", () => {
    const ass = buildAss(
      [seg("a", 0, 4, "one two three four")],
      { ...defaultCaptionStyle, wordsPerLine: 2 },
      1080,
      1920,
      false
    );
    expect(ass).toContain("one two\\Nthree four");
  });

  it("anchors every event at the drag-placed center when offsets are set", () => {
    const ass = buildAss(
      [seg("a", 0, 2, "hello world")],
      { ...defaultCaptionStyle, offsetX: 0.5, offsetY: 0.25 },
      1080,
      1920,
      true
    );
    const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue: 0,"));
    expect(dialogues.length).toBeGreaterThan(0);
    for (const line of dialogues) expect(line).toContain("{\\an5\\pos(540,480)}");
  });

  it("leaves events unpositioned when no offsets are set", () => {
    const ass = buildAss([seg("a", 0, 2, "hello world")], defaultCaptionStyle, 1080, 1920, false);
    expect(ass).not.toContain("\\pos(");
  });
});

describe("buildWatermarkDialogue", () => {
  it("renders a bottom-left CoLateral AI lockup spanning the given range", () => {
    const line = buildWatermarkDialogue(1920, 0, 12.5);
    // Two dialogue lines (badge + wordmark) on the Watermark style, layer 2.
    const lines = line.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Dialogue: 2,0:00:00.00,0:00:12.50,Watermark,/);
    expect(lines[0]).toContain("\\an1"); // badge anchored bottom-left
    expect(lines[0]).toContain("\\p1"); // drawn purple badge
    expect(lines[1]).toContain("CoLateral AI");
  });

  it("pins the lockup to the top-left when position is top", () => {
    const height = 1920;
    const pad = Math.round(height * 0.035);
    const fs = Math.max(10, Math.round(height * 0.03));
    const badge = Math.round(fs * 1.15);
    const top = buildWatermarkDialogue(height, 0, 12.5, "top");
    const bottom = buildWatermarkDialogue(height, 0, 12.5);
    const [topBadge, topWordmark] = top.split("\n");
    // Badge sits just below the top pad: its bottom edge (\an1 anchor) is pad+badge.
    expect(topBadge).toContain(`\\pos(${pad},${pad + badge})`);
    // Wordmark is vertically centered on the badge.
    expect(topWordmark).toContain(`\\pos(${pad + badge + Math.round(fs * 0.4)},${pad + badge - Math.round(badge / 2)})`);
    expect(topWordmark).toContain("CoLateral AI");
    // Top placement is genuinely higher than the default bottom placement.
    expect(top).not.toEqual(bottom);
  });
});
