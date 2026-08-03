import { describe, expect, it } from "vitest";
import type { CaptionSegment } from "@/types/domain";
import type { ClipCandidate } from "@/lib/clipping/types";
import {
  adCanvasSize,
  fitCover,
  realisticImagePrompt,
  speechWordCount,
  visualMomentFromClips
} from "@/lib/pipeline/visual-brief";

function clip(id: string, score: number, start: number, end: number, title?: string): ClipCandidate {
  return {
    id,
    score,
    start,
    end,
    title,
    rationale: "Strong standalone moment.",
    breakdown: { hook: score, pacing: score, standalone: score, intensity: score }
  };
}

function caption(id: string, start: number, end: number, text: string): CaptionSegment {
  return { id, start, end, text, enabled: true, words: [] };
}

describe("visualMomentFromClips", () => {
  it("uses the strongest clip and only its transcript window", () => {
    const moment = visualMomentFromClips(
      [
        clip("clip-1", 60, 5, 15, "A Decent Moment"),
        clip("clip-2", 94, 30, 42, "This Changed How I Build Software")
      ],
      [
        caption("a", 5, 10, "Earlier context."),
        caption("b", 30, 35, "I stopped planning every detail."),
        caption("c", 35, 42, "Then I shipped the working version live."),
        caption("d", 50, 55, "A later thought.")
      ]
    );

    expect(moment).toEqual({
      headline: "This Changed How I Build Software",
      transcript: "I stopped planning every detail. Then I shipped the working version live.",
      start: 30,
      end: 42
    });
  });

  it("creates a compact fallback headline when the title is absent", () => {
    const moment = visualMomentFromClips(
      [clip("clip-1", 80, 0, 10)],
      [caption("a", 0, 10, "this is the exact point where the whole workflow finally clicked for me.")]
    );
    expect(moment?.headline).toBe("this is the exact point where the whole");
  });

  it("returns null when the transcript is nothing but Whisper's non-speech tags", () => {
    // 25 seconds of a sine tone transcribed to "(bells ringing)" and the
    // pipeline built a whole content pack around it.
    const moment = visualMomentFromClips(
      [clip("clip-1", 40, 0, 20)],
      [caption("a", 0, 20, "(bells ringing)")]
    );
    expect(moment).toBeNull();
  });

  it("returns null when there is neither transcript nor hook quote", () => {
    expect(visualMomentFromClips([clip("clip-1", 40, 0, 20)], [])).toBeNull();
  });

  it("ignores clips and captions stamped past the end of the media", () => {
    const moment = visualMomentFromClips(
      [clip("late", 95, 28, 34, "Stamped Past The End"), clip("real", 60, 2, 12, "Actually In Shot")],
      [
        caption("a", 2, 12, "This one genuinely happened during the recording."),
        caption("b", 28, 34, "(bells ringing)")
      ],
      25
    );
    expect(moment?.headline).toBe("Actually In Shot");
  });
});

describe("speechWordCount", () => {
  it("counts spoken words and ignores bracketed sound tags", () => {
    expect(speechWordCount("(bells ringing) [MUSIC]")).toBe(0);
    expect(speechWordCount("(music) so anyway I shipped it [applause]")).toBe(5);
  });

  it("treats an empty transcript as no speech", () => {
    expect(speechWordCount("")).toBe(0);
  });
});

describe("realisticImagePrompt", () => {
  it("grounds the prompt in the transcript and explicitly rejects cartoon output", () => {
    const prompt = realisticImagePrompt(
      {
        headline: "I Built the Feature Live",
        transcript: "The real breakthrough was using the stream itself.",
        start: 12,
        end: 30
      },
      "Capital Command Live"
    );
    expect(prompt).toContain("high-fidelity visual reference");
    expect(prompt).toContain("The real breakthrough");
    expect(prompt).toContain("photorealistic");
    expect(prompt).toContain("Avoid cartoons");
    expect(prompt).toContain("No invented logos");
  });
});

describe("visual ad geometry", () => {
  it("provides all social formats", () => {
    expect(adCanvasSize("portrait")).toMatchObject({ width: 1080, height: 1350 });
    expect(adCanvasSize("story")).toMatchObject({ width: 1080, height: 1920 });
    expect(adCanvasSize("square")).toMatchObject({ width: 1080, height: 1080 });
    expect(adCanvasSize("landscape")).toMatchObject({ width: 1920, height: 1080 });
  });

  it("cover-crops without leaving empty space", () => {
    expect(fitCover(1920, 1080, 1080, 1350)).toEqual({
      x: -660,
      y: 0,
      width: 2400,
      height: 1350
    });
  });
});
