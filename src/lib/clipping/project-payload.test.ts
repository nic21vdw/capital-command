import { describe, expect, it } from "vitest";
import { projectSignature, projectWithoutCaptions, stampProjectSignature } from "@/lib/clipping/project-payload";
import type { CaptionSegment, ClipProject } from "@/types/domain";

/**
 * The payload drops captions; the signature is what the Uploading Center used
 * them for. If a stamped signature ever stopped matching the one computed from
 * the whole project, every rendered clip would silently read as stale.
 */
const caption = (id: string, start: number): CaptionSegment => ({
  id,
  start,
  end: start + 1,
  text: `line ${id}`,
  words: [{ text: "line", start, end: start + 0.4 }],
  enabled: true
});

function project(overrides: Partial<ClipProject> = {}): ClipProject {
  return {
    id: "p1",
    name: "Clip",
    jobId: "job-1",
    sourceFile: "a.mp4",
    sourceUrl: "",
    baseDurationSec: 30,
    baseWidth: 1920,
    baseHeight: 1080,
    clipStart: 0,
    clipEnd: 30,
    trimStart: 0,
    trimEnd: 0,
    segments: [],
    title: "",
    aspectRatio: "9:16",
    compositionMode: "center-blur",
    reframe: { scale: 1, offsetX: 0, offsetY: 0 },
    captions: [caption("c1", 0), caption("c2", 2)],
    captionStyle: { maxWordsPerCaption: 4 },
    captionsVisible: true,
    highlightCurrentWord: true,
    overlays: [],
    audio: {},
    exportSettings: {},
    suggestions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  } as unknown as ClipProject;
}

describe("stampProjectSignature", () => {
  it("stamps the signature the whole project hashes to, plus the caption count", () => {
    const stamped = stampProjectSignature(project());
    expect(stamped.renderSignature).toBe(projectSignature(project()));
    expect(stamped.captionCount).toBe(2);
  });

  it("returns the same object when the stamp is already correct, so no write happens", () => {
    const stamped = stampProjectSignature(project());
    expect(stampProjectSignature(stamped)).toBe(stamped);
  });

  it("changes the signature when the captions change", () => {
    const a = stampProjectSignature(project());
    const b = stampProjectSignature(project({ captions: [caption("c1", 0)] }));
    expect(a.renderSignature).not.toBe(b.renderSignature);
  });
});

describe("projectWithoutCaptions", () => {
  it("drops the captions, keeps the signature they hash to, and flags the copy", () => {
    const listed = projectWithoutCaptions(project());

    expect(listed.captions).toEqual([]);
    expect(listed.captionsOmitted).toBe(true);
    expect(listed.captionCount).toBe(2);
    // The whole point: this still matches a render made from the full project.
    expect(listed.renderSignature).toBe(projectSignature(project()));
  });

  it("keeps everything else the editor and the board read", () => {
    const listed = projectWithoutCaptions(project({ title: "Kept" }));
    expect(listed.title).toBe("Kept");
    expect(listed.exportSettings).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain("line c1");
  });
});
