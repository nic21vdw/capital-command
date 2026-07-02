import { describe, expect, it } from "vitest";
import { applyCaptionPreset, aspectDimensions, makeClipProject } from "./editor";
import { appDataSchema, clipProjectSchema, defaultCaptionStyle } from "@/lib/storage/schemas";
import { seedData } from "@/lib/mockData/seed";

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
  it("derives duration from the clip window and uses sane defaults", () => {
    const p = baseProject();
    expect(p.baseDurationSec).toBeCloseTo(30);
    expect(p.baseWidth).toBe(1920);
    expect(p.baseHeight).toBe(1080);
    expect(p.aspectRatio).toBe("16:9");
    expect(p.compositionMode).toBe("center-blur");
    expect(p.captionsVisible).toBe(true);
    expect(p.exportSettings.width).toBe(1920);
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
