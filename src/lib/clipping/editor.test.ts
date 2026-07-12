import { describe, expect, it } from "vitest";
import {
  applyCaptionPreset,
  aspectDimensions,
  generateClipDescription,
  generateClipHashtags,
  generateClipTitle,
  generateClipTitleCandidates,
  leadingSilenceSec,
  makeClipProject,
  makeTitleOverlay
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

describe("makeTitleOverlay", () => {
  it("seeds an editable purple text overlay carrying the clip title", () => {
    const p = baseProject();
    p.title = "My Great Short";
    const overlay = makeTitleOverlay(p);
    expect(overlay.kind).toBe("text");
    expect(overlay.text).toBe("My Great Short");
    expect(overlay.color).toBe("#bd93f9");
    expect(overlay.locked).toBe(false);
    // Visible for the whole clip.
    expect(overlay.start).toBe(0);
    expect(overlay.end).toBeCloseTo(p.trimEnd - p.trimStart);
  });

  it("sits just above the centered video band of the 9:16 blur layout", () => {
    const p = baseProject(); // 1920x1080 source in a 9:16 frame
    p.title = "Title";
    const overlay = makeTitleOverlay(p);
    // Contain-fit video top edge: (1 - (9/16)/(16/9)) / 2 ≈ 0.342.
    const videoTop = (1 - 9 / 16 / (16 / 9)) / 2;
    expect(overlay.x).toBeCloseTo(0.5);
    expect(overlay.y).toBeLessThan(videoTop);
    expect(overlay.y).toBeGreaterThan(0.05); // inside the safe area
  });

  it("clamps into the safe area when the source already fills the frame", () => {
    const p = baseProject();
    p.title = "Tall";
    p.baseWidth = 1080;
    p.baseHeight = 1920; // vertical source: no letterbox band above the video
    const overlay = makeTitleOverlay(p);
    expect(overlay.y).toBeCloseTo(0.08);
  });

  it("falls back to the project name when no title was generated", () => {
    const p = baseProject();
    p.title = "";
    expect(makeTitleOverlay(p).text).toBe("Test clip");
  });

  it("round-trips through the storage schema", () => {
    const p = baseProject();
    p.title = "Persisted Title";
    p.overlays = [makeTitleOverlay(p)];
    const parsed = clipProjectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(parsed.overlays[0]).toEqual(p.overlays[0]);
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

describe("leadingSilenceSec", () => {
  const seg = (start: number, end: number, words: Array<[string, number, number]>): CaptionSegment => ({
    id: `s-${start}`,
    start,
    end,
    text: words.map(([t]) => t).join(" "),
    words: words.map(([text, ws, we]) => ({ text, start: ws, end: we })),
    enabled: true
  });

  it("returns the clip-local start of the first spoken word, minus a small pre-roll", () => {
    // First word lands 2s in — the clip opens on 2s of silence.
    const captions = [seg(2, 3, [["hello", 2, 2.4], ["there", 2.5, 3]])];
    expect(leadingSilenceSec(captions)).toBeCloseTo(2 - 0.12);
  });

  it("skips nothing when the clip opens right on speech", () => {
    const captions = [seg(0.1, 1, [["go", 0.1, 0.5]])];
    expect(leadingSilenceSec(captions)).toBe(0);
  });

  it("ignores segment order and keys off the earliest word", () => {
    const captions = [seg(5, 6, [["later", 5, 5.5]]), seg(1.5, 2, [["first", 1.5, 2]])];
    expect(leadingSilenceSec(captions)).toBeCloseTo(1.5 - 0.12);
  });

  it("returns 0 when there is no transcript", () => {
    expect(leadingSilenceSec([])).toBe(0);
  });

  it("falls back to the segment start when a segment has no word timings", () => {
    const captions: CaptionSegment[] = [
      { id: "s1", start: 3, end: 4, text: "hi there", words: [], enabled: true }
    ];
    expect(leadingSilenceSec(captions)).toBeCloseTo(3 - 0.12);
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
