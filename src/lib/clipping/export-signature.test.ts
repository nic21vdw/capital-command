import { describe, expect, it } from "vitest";
import { makeClipProject } from "@/lib/clipping/editor";
import { effectiveTrim, hasEditsBeyondAutoRender, renderSignature } from "@/lib/clipping/export-signature";
import type { ClipProject } from "@/types/domain";

function baseProject(): ClipProject {
  return makeClipProject({
    jobId: "job-1",
    name: "Clip 1",
    sourceFile: "clip-01.mp4",
    sourceUrl: "https://example.com/v",
    clipStart: 0,
    clipEnd: 30
  });
}

/** The render-signature view of a project (maps exportSettings → settings). */
function sig(project: ClipProject) {
  return renderSignature({ ...project, settings: project.exportSettings });
}

describe("effectiveTrim", () => {
  it("treats a zero trimEnd as the full duration", () => {
    expect(effectiveTrim({ baseDurationSec: 30, trimStart: 0, trimEnd: 0 })).toEqual({ start: 0, end: 30 });
  });

  it("clamps trim points inside the clip", () => {
    expect(effectiveTrim({ baseDurationSec: 30, trimStart: -5, trimEnd: 100 })).toEqual({ start: 0, end: 30 });
  });
});

describe("renderSignature", () => {
  it("is stable for identical edits", () => {
    expect(sig(baseProject())).toBe(sig(baseProject()));
  });

  it("changes when the trim changes", () => {
    const trimmed = { ...baseProject(), trimStart: 5, trimEnd: 20 };
    expect(sig(trimmed)).not.toBe(sig(baseProject()));
  });

  it("ignores title and name (they don't affect the rendered video)", () => {
    const renamed = { ...baseProject(), title: "A new title", name: "Different name" };
    expect(sig(renamed)).toBe(sig(baseProject()));
  });

  it("treats trimEnd=0 and trimEnd=duration as the same cut", () => {
    const full = { ...baseProject(), trimEnd: 0 };
    const explicit = { ...baseProject(), trimEnd: 30 };
    expect(sig(full)).toBe(sig(explicit));
  });

  it("changes when captions are edited", () => {
    const withCaption = {
      ...baseProject(),
      captions: [{ id: "c1", start: 1, end: 2, text: "Hello", words: [], enabled: true }]
    };
    expect(sig(withCaption)).not.toBe(sig(baseProject()));
  });

  it("changes with the caption style", () => {
    const project = baseProject();
    const styled = {
      ...project,
      captionStyle: { ...project.captionStyle, fontScale: project.captionStyle.fontScale + 0.02 }
    };
    expect(sig(styled)).not.toBe(sig(project));
  });
});

describe("hasEditsBeyondAutoRender", () => {
  const view = (project: ClipProject) => ({ ...project, settings: project.exportSettings });

  it("is false for an untouched project (the auto render already matches)", () => {
    expect(hasEditsBeyondAutoRender(view(baseProject()))).toBe(false);
  });

  it("is true once the clip is trimmed", () => {
    expect(hasEditsBeyondAutoRender(view({ ...baseProject(), trimStart: 3 }))).toBe(true);
    expect(hasEditsBeyondAutoRender(view({ ...baseProject(), trimEnd: 25 }))).toBe(true);
  });

  it("is true when an overlay is added", () => {
    const project = baseProject();
    const withOverlay = {
      ...project,
      overlays: [
        {
          id: "ov1",
          kind: "text" as const,
          text: "Hi",
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          opacity: 1,
          z: 0,
          locked: false,
          start: 0,
          end: 5
        }
      ]
    };
    expect(hasEditsBeyondAutoRender(view(withOverlay))).toBe(true);
  });

  it("is true when the watermark is enabled", () => {
    const project = baseProject();
    const watermarked = { ...project, exportSettings: { ...project.exportSettings, watermark: true } };
    expect(hasEditsBeyondAutoRender(view(watermarked))).toBe(true);
  });

  it("ignores a sub-frame trim jitter (never flags a nudge as a real trim)", () => {
    expect(hasEditsBeyondAutoRender(view({ ...baseProject(), trimStart: 0.02, trimEnd: 29.98 }))).toBe(false);
  });
});
