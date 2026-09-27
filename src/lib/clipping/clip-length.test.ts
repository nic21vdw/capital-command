import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionSegment } from "@/types/domain";

const runAi = vi.fn();
vi.mock("@/lib/ai", () => ({ aiConfigured: () => true, runAi: (...args: unknown[]) => runAi(...args) }));

const { selectByTranscript } = await import("./transcript-select");
const { CLIP_LENGTHS, clipLengthBounds, isClipLengthId } = await import("./clip-length");

function sentences(duration: number): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  for (let t = 0; t < duration; t += 5) {
    segments.push({ id: `s-${t}`, start: t, end: t + 5, text: `Point number ${t} lands here.`, words: [], enabled: true });
  }
  return segments;
}

describe("clip length presets", () => {
  it("falls back to the auto range for unknown ids", () => {
    expect(isClipLengthId("standard")).toBe(true);
    expect(isClipLengthId("huge")).toBe(false);
    expect(clipLengthBounds("huge")).toEqual({ min: 15, preferredMax: 30, max: 45 });
  });

  it("keeps every preset internally ordered", () => {
    for (const preset of Object.values(CLIP_LENGTHS)) {
      expect(preset.min).toBeLessThan(preset.preferredMax);
      expect(preset.preferredMax).toBeLessThanOrEqual(preset.max);
    }
  });
});

describe("selectByTranscript with a clip length", () => {
  beforeEach(() => {
    runAi.mockReset();
    runAi.mockResolvedValue({ text: JSON.stringify([{ start: 100, end: 170, title: "A Long Story", reason: "It lands." }]) });
  });

  it("asks the model for the chosen range and keeps a 70s moment under Standard", async () => {
    const clips = await selectByTranscript(sentences(600), 600, undefined, 1, clipLengthBounds("standard"));
    const prompt = runAi.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("between 30 and 60 seconds");
    expect(prompt).toContain("never exceed 75 seconds");
    expect(clips?.[0].end).toBeGreaterThan(160);
  });

  it("caps the same moment at 45s under Auto", async () => {
    const clips = await selectByTranscript(sentences(600), 600, undefined, 1);
    const prompt = runAi.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("between 15 and 30 seconds");
    expect(clips).not.toBeNull();
    for (const clip of clips ?? []) expect(clip.end - clip.start).toBeLessThanOrEqual(45);
  });
});
