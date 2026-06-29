import { describe, expect, it } from "vitest";
import { analyzeTranscript, densityScore } from "./text-signals";
import type { CaptionSegment } from "@/types/domain";

/** Builds a caption segment whose words are spread evenly across [start, end]. */
function seg(id: string, start: number, end: number, text: string): CaptionSegment {
  const tokens = text.split(/\s+/).filter(Boolean);
  const step = (end - start) / Math.max(1, tokens.length);
  return {
    id,
    start,
    end,
    text,
    words: tokens.map((t, i) => ({ text: t, start: start + step * i, end: start + step * (i + 1) })),
    enabled: true
  };
}

describe("analyzeTranscript", () => {
  it("reports no usable text when the range is empty", () => {
    const result = analyzeTranscript([], 0, 30);
    expect(result.hasText).toBe(false);
    expect(result.hook).toBe(0);
    expect(result.standalone).toBe(0);
  });

  it("rewards a clip that opens on a question and ends on a full sentence", () => {
    const captions = [seg("a", 0, 30, "Why do most traders blow up their accounts in the first year?")];
    const result = analyzeTranscript(captions, 0, 30);
    expect(result.hasText).toBe(true);
    expect(result.hook).toBeGreaterThan(60);
    expect(result.standalone).toBeGreaterThan(70);
    expect(result.opening.length).toBeGreaterThan(0);
  });

  it("penalizes a clip that opens on a back-reference and is cut mid-sentence", () => {
    const dangling = [seg("a", 0, 30, "and that is why they kept losing money over and over because")];
    const clean = [seg("b", 0, 30, "Risk management is the single most important skill you can learn.")];
    const danglingScore = analyzeTranscript(dangling, 0, 30).standalone;
    const cleanScore = analyzeTranscript(clean, 0, 30).standalone;
    expect(danglingScore).toBeLessThan(cleanScore);
    expect(danglingScore).toBeLessThan(50);
  });

  it("penalizes a filler-word opener in the hook score", () => {
    const filler = analyzeTranscript([seg("a", 0, 30, "um so yeah anyway it was kind of fine i guess okay")], 0, 30).hook;
    const strong = analyzeTranscript([seg("b", 0, 30, "Here's the biggest mistake nobody tells you about.")], 0, 30).hook;
    expect(filler).toBeLessThan(strong);
  });

  it("produces different standalone scores for different content (not always 100)", () => {
    const a = analyzeTranscript([seg("a", 0, 20, "this happened next and then it got worse somehow")], 0, 20).standalone;
    const b = analyzeTranscript([seg("b", 0, 20, "The market crashed in 2008. Everyone panicked.")], 0, 20).standalone;
    expect(a).not.toBe(b);
  });
});

describe("densityScore", () => {
  it("rewards higher word density and only tapers at extreme speed", () => {
    expect(densityScore(0)).toBe(0);
    expect(densityScore(2.8)).toBeGreaterThan(densityScore(1.4));
    expect(densityScore(3.4)).toBeGreaterThanOrEqual(99);
    expect(densityScore(3.4)).toBeGreaterThan(densityScore(5));
  });
});
