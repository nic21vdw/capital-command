import { describe, expect, it } from "vitest";
import { clipProjectSchema } from "@/lib/storage/schemas";
import { DEFAULT_BRAND_KIT } from "./defaults";
import { resolveBrandKit } from "./rules";
import { captureVideoLook, videoLookBrief, videoLookPatch, videoLookSchema } from "./video-look";

const project = clipProjectSchema.parse({
  id: "look-test", jobId: "synthetic-job", sourceFile: "synthetic.webm",
  createdAt: "2026-11-12T12:00:00Z", updatedAt: "2026-11-12T12:00:00Z",
  baseDurationSec: 12, trimStart: 1, trimEnd: 9,
  title: "Keep these words", description: "Keep this copy",
  captionStyle: { textColor: "#00aaff", italic: true, offsetX: 0.25, offsetY: 0.6 },
  captions: [{ id: "caption", start: 2, end: 5, text: "A useful moment", words: [], enabled: true }],
  segments: [{ id: "kept", start: 1, end: 6, kind: "speech", enabled: true }],
  overlays: [{ id: "overlay", kind: "text", text: "Keep overlay" }]
});

describe("brand video looks", () => {
  it("leaves existing kits empty until a user deliberately saves a look", () => {
    expect(DEFAULT_BRAND_KIT.videoLooks).toEqual([]);
    const old = resolveBrandKit({ identity: { handle: "@saved" } });
    expect(old.kit.videoLooks).toEqual([]);
    expect(old.overrides).toEqual({ identity: { handle: "@saved" } });
  });

  it("captures presentation without retaining project content or source-specific placement", () => {
    const look = captureVideoLook(project, "walkthrough", "Walkthrough", "Keep natural pauses.");
    expect(look.captionStyle.textColor).toBe("#00aaff");
    expect(look.captionStyle).not.toHaveProperty("offsetX");
    expect(JSON.stringify(look)).not.toMatch(/synthetic|Keep these|useful moment|offsetY/);
    expect(videoLookBrief(look)).toContain("Editorial guidance (manual, not automatically applied): Keep natural pauses.");
  });

  it("applies only caption presentation and burn preference, idempotently, without mutating either input", () => {
    const look = captureVideoLook(project, "walkthrough", "Walkthrough", "Do not cut breathing.");
    const target = structuredClone(project);
    target.captionStyle.textColor = "#ffffff";
    target.captionStyle.offsetX = 0.8;
    target.captionStyle.offsetY = 0.2;
    target.exportSettings = { ...target.exportSettings, filename: "kept-filename", width: 1280, height: 720, fps: 24, burnCaptions: false };
    const before = structuredClone(target);
    const applied = { ...target, ...videoLookPatch(target, look) };
    expect(target).toEqual(before);
    expect(applied.captionStyle.textColor).toBe("#00aaff");
    expect(applied.captionStyle.offsetX).toBe(0.8);
    expect(applied.captionStyle.offsetY).toBe(0.2);
    expect(applied.exportSettings).toEqual({ ...before.exportSettings, burnCaptions: true });
    const unchanged = (value: typeof applied) => Object.fromEntries(Object.entries(value).filter(([key]) => !["captionStyle", "captionsVisible", "highlightCurrentWord", "exportSettings"].includes(key)));
    expect(unchanged(applied)).toEqual(unchanged(before));
    expect({ ...applied, ...videoLookPatch(applied, look) }).toEqual(applied);
  });

  it("rejects unbounded and unsupported preferences and duplicate ids", () => {
    const look = captureVideoLook(project, "walkthrough", "Walkthrough", "");
    expect(videoLookSchema.safeParse({ ...look, guidance: "a".repeat(1201) }).success).toBe(false);
    expect(videoLookSchema.safeParse({ ...look, captionStyle: { ...look.captionStyle, textColor: "url(https://invalid.example)" } }).success).toBe(false);
    expect(resolveBrandKit({ videoLooks: [look, look] }).issues.join(" ")).toContain("unique id");
    expect(resolveBrandKit({ videoLooks: [{ id: "incomplete" }] }).issues.length).toBeGreaterThan(0);
  });
});
