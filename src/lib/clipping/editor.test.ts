import { describe, expect, it } from "vitest";
import {
  applyCaptionPreset,
  aspectDimensions,
  generateClipDescription,
  generateClipHashtags,
  generateClipTitle,
  generateClipTitleCandidates,
  makeClipProject
} from "./editor";
import { appDataSchema, clipProjectSchema, defaultCaptionStyle } from "@/lib/storage/schemas";
import { seedData } from "@/lib/mockData/seed";
import type { CaptionSegment } from "@/types/domain";

const caption = (id: string, text: string): CaptionSegment => ({
  id,
  start: 0,
  end: 1,
  text,
  words: [],
  enabled: true
});

const baseProject = () =>
  makeClipProject({
    jobId: "job1",
    name: "Test clip",
    sourceFile: "clip-01.mp4",
    sourceUrl: "https://example.com/v",
    clipStart: 10,
    clipEnd: 40
  });

describe("makeClipProject", () => {
  it("derives duration from the clip window and opens Shorts-ready", () => {
    const p = baseProject();
    expect(p.baseDurationSec).toBeCloseTo(30);
    expect(p.baseWidth).toBe(1920);
    expect(p.baseHeight).toBe(1080);
    // New projects target Shorts/Reels out of the box: 9:16 vertical export
    // with word-synced captions on.
    expect(p.aspectRatio).toBe("9:16");
    expect(p.compositionMode).toBe("center-blur");
    expect(p.captionsVisible).toBe(true);
    expect(p.highlightCurrentWord).toBe(true);
    expect(p.exportSettings.preset).toBe("shorts");
    expect(p.exportSettings.width).toBe(1080);
    expect(p.exportSettings.height).toBe(1920);
  });
});

describe("aspectDimensions", () => {
  it("returns the right pixel size for each ratio", () => {
    expect(aspectDimensions("9:16")).toEqual({ w: 1080, h: 1920 });
    expect(aspectDimensions("16:9")).toEqual({ w: 1920, h: 1080 });
    expect(aspectDimensions("1:1")).toEqual({ w: 1080, h: 1080 });
    expect(aspectDimensions("4:5")).toEqual({ w: 1080, h: 1350 });
  });
});

describe("applyCaptionPreset", () => {
  it("merges preset values over the current style", () => {
    const styled = applyCaptionPreset(defaultCaptionStyle, "bold-shorts");
    expect(styled.uppercase).toBe(true);
    expect(styled.fontWeight).toBe(900);
  });
});

describe("generateClipTitleCandidates", () => {
  it("drops weak opener and dangling closer words for a cleaner title", () => {
    // The old generator produced "Is The Marketing Scheme We Want To".
    const captions = [caption("c1", "Is the marketing scheme we want to run this quarter really working out.")];
    const [best] = generateClipTitleCandidates(captions);
    expect(best).toBeTruthy();
    expect(best.toLowerCase().startsWith("is the")).toBe(false);
    expect(/\bto$/i.test(best)).toBe(false);
    // First word is capitalized (proper title case).
    expect(best[0]).toBe(best[0].toUpperCase());
  });

  it("ranks hooky, well-sized titles ahead of weaker fragments", () => {
    const captions = [
      caption("c1", "Um so yeah okay."),
      caption("c2", "The biggest mistake new investors make every single year is chasing hype.")
    ];
    const candidates = generateClipTitleCandidates(captions);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].toLowerCase()).toContain("biggest mistake");
  });

  it("returns an empty list when there is no caption text", () => {
    expect(generateClipTitleCandidates([])).toEqual([]);
    expect(generateClipTitle([], "Fallback")).toBe("Fallback");
  });
});

describe("generateClipHashtags", () => {
  it("surfaces the most-repeated meaningful words as hashtags", () => {
    const captions = [
      caption("c1", "Bitcoin is the future. Bitcoin will change finance."),
      caption("c2", "Everyone should understand bitcoin and finance before investing in finance.")
    ];
    const tags = generateClipHashtags(captions);
    expect(tags).toContain("#Bitcoin");
    expect(tags.every((tag) => tag.startsWith("#"))).toBe(true);
  });
});

describe("generateClipDescription", () => {
  it("always returns the standing CoLateral description, regardless of transcript", () => {
    const captions = [
      caption("c1", "Bitcoin is the future of money. Bitcoin keeps growing every year."),
      caption("c2", "Everyone should learn about bitcoin and money management today.")
    ];
    const description = generateClipDescription(captions);
    expect(description).toContain("CoLateral");
    expect(description).toContain("https://colateral.ai");
    expect(description).toContain("#BuildInPublic");
  });

  it("returns the same standing description with no captions", () => {
    expect(generateClipDescription([])).toBe(generateClipDescription([caption("c1", "hi")]));
  });
});

describe("persistence round-trip (survives refresh)", () => {
  it("a fully-edited project survives serialize -> parse unchanged", () => {
    const p = baseProject();
    p.captions = [{ id: "c1", start: 0, end: 2, text: "hi", words: [{ text: "hi", start: 0, end: 2 }], enabled: true }];
    p.overlays = [
      { id: "o1", kind: "text", text: "brand", x: 0.5, y: 0.5, scale: 1, rotation: 10, opacity: 0.8, z: 0, locked: false, start: 0, end: 3, color: "#fff" }
    ];
    p.audio.fadeIn = 0.5;
    p.exportSettings.preset = "square";
    p.suggestions = [{ id: "s1", start: 0, end: 5, score: 80, rationale: "loud", status: "approved", addedToTimeline: true }];

    const json = JSON.parse(JSON.stringify(p));
    const parsed = clipProjectSchema.parse(json);
    expect(parsed).toEqual(p);
  });

  it("appDataSchema accepts clip projects so the store persists them", () => {
    const data = { ...seedData, clipProjects: [baseProject()] };
    const parsed = appDataSchema.parse(JSON.parse(JSON.stringify(data)));
    expect(parsed.clipProjects).toHaveLength(1);
    expect(parsed.clipProjects[0].name).toBe("Test clip");
  });
});
