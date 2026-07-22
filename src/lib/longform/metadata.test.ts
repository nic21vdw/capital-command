import { describe, expect, it } from "vitest";
import {
  buildLongformMetadataPrompt,
  chapterBlock,
  fallbackLongformMetadata,
  formatChapterTime,
  parseLongformMetadata,
  toEditedSeconds,
  transcriptLines
} from "@/lib/longform/metadata";
import type { LongformSegment } from "@/lib/longform/types";
import type { CaptionSegment } from "@/types/domain";

const seg = (start: number, end: number, kind: "speech" | "silence", enabled: boolean): LongformSegment => ({
  id: `${start}-${end}`,
  start,
  end,
  kind,
  enabled
});

const cap = (start: number, end: number, text: string): CaptionSegment => ({
  id: `${start}`,
  start,
  end,
  text,
  words: [],
  enabled: true
});

describe("formatChapterTime", () => {
  it("formats minutes and hours", () => {
    expect(formatChapterTime(0)).toBe("0:00");
    expect(formatChapterTime(65)).toBe("1:05");
    expect(formatChapterTime(3661)).toBe("1:01:01");
  });
});

describe("toEditedSeconds", () => {
  const segments = [
    seg(0, 10, "speech", true),
    seg(10, 20, "silence", false), // cut
    seg(20, 30, "speech", true)
  ];

  it("passes through time before any cut", () => {
    expect(toEditedSeconds(5, segments)).toBe(5);
  });

  it("subtracts cuts fully before the time", () => {
    expect(toEditedSeconds(25, segments)).toBe(15);
  });

  it("subtracts the elapsed part of a cut in progress", () => {
    expect(toEditedSeconds(14, segments)).toBe(10);
  });
});

describe("transcriptLines", () => {
  it("stamps lines with edited-runtime times", () => {
    const segments = [seg(0, 60, "speech", true)];
    const transcript = [cap(0, 2, "hello"), cap(40, 42, "world")];
    const text = transcriptLines(transcript, segments);
    expect(text).toContain("[0:00] hello");
    expect(text).toContain("world");
  });
});

describe("parseLongformMetadata", () => {
  it("parses a fenced reply and cleans titles", () => {
    const reply = [
      "Here you go:",
      "```json",
      JSON.stringify({
        titles: ['"How I Built a SaaS With AI"', "x", "Why Vibe Coding Wins #ai"],
        description: "A great video.",
        tags: ["#AI", "AI", "vibe coding"],
        chapters: [
          { time: "0:00", label: "Intro" },
          { time: "bad", label: "Nope" }
        ]
      }),
      "```"
    ].join("\n");
    const parsed = parseLongformMetadata(reply);
    expect(parsed).not.toBeNull();
    expect(parsed!.titles[0]).toBe("How I Built a SaaS With AI");
    // Too-short title dropped, hashtag stripped from the surviving one.
    expect(parsed!.titles).not.toContain("x");
    expect(parsed!.tags).toEqual(["AI", "vibe coding"]);
    expect(parsed!.chapters).toEqual([{ time: "0:00", label: "Intro" }]);
  });

  it("returns null when there is no usable JSON", () => {
    expect(parseLongformMetadata("sorry, no")).toBeNull();
    expect(parseLongformMetadata('{"titles": [], "description": ""}')).toBeNull();
  });
});

describe("chapterBlock", () => {
  it("is empty without chapters and formatted with them", () => {
    expect(chapterBlock([])).toBe("");
    expect(chapterBlock([{ time: "0:00", label: "Intro" }])).toBe("\n\nChapters:\n0:00 Intro");
  });
});

describe("fallbackLongformMetadata", () => {
  it("always yields titles, a description and tags", () => {
    const fallback = fallbackLongformMetadata({ name: "My Stream" });
    expect(fallback.titles.length).toBeGreaterThan(2);
    expect(fallback.description).toContain("My Stream");
    expect(fallback.tags.length).toBeGreaterThan(5);
    expect(fallback.source).toBe("fallback");
  });
});

describe("buildLongformMetadataPrompt", () => {
  it("asks for chapters only when wanted", () => {
    const base = { name: "Test", durationSec: 600, transcriptText: "[0:00] hi" };
    expect(buildLongformMetadataPrompt({ ...base, wantChapters: true })).toContain('"chapters"');
    expect(buildLongformMetadataPrompt({ ...base, wantChapters: false })).not.toContain('"chapters"');
  });
});
