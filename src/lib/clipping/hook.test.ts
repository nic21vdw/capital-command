import { describe, expect, it } from "vitest";
import type { CaptionSegment } from "@/types/domain";
import { hookTrimSec, MIN_HOOK_TRIM_SEC, shiftSegments } from "./hook";

function seg(id: string, start: number, end: number, words: Array<[string, number, number]>): CaptionSegment {
  return {
    id,
    start,
    end,
    text: words.map(([t]) => t).join(" "),
    words: words.map(([text, s, e]) => ({ text, start: s, end: e })),
    enabled: true
  };
}

describe("hookTrimSec", () => {
  it("cuts the opening pause so the short starts on the first word", () => {
    expect(hookTrimSec(1.8, 30)).toBeCloseTo(1.8);
  });

  it("leaves a pause too short to notice alone", () => {
    expect(hookTrimSec(0.3, 30)).toBe(0);
    expect(hookTrimSec(0, 30)).toBe(0);
  });

  it("never eats more than a quarter of the clip", () => {
    expect(hookTrimSec(12, 20)).toBeCloseTo(5);
  });

  it("never leaves a stub instead of a short", () => {
    expect(hookTrimSec(4, 8)).toBeCloseTo(2);
    expect(hookTrimSec(4, 5)).toBe(0);
  });

  it("gives up rather than make a cut smaller than the floor", () => {
    expect(hookTrimSec(3, 5.2)).toBe(0);
    expect(hookTrimSec(3, 5.2)).toBeLessThan(MIN_HOOK_TRIM_SEC);
  });

  it("survives nonsense inputs instead of trimming by NaN", () => {
    expect(hookTrimSec(Number.NaN, 30)).toBe(0);
    expect(hookTrimSec(2, Number.NaN)).toBe(0);
  });
});

describe("shiftSegments", () => {
  const segments = [
    seg("a", 0.2, 1.0, [["um", 0.2, 1.0]]),
    seg("b", 1.6, 3.0, [
      ["so", 1.6, 1.9],
      ["here", 2.0, 3.0]
    ])
  ];

  it("returns the segments untouched when nothing is trimmed", () => {
    expect(shiftSegments(segments, 0)).toBe(segments);
  });

  it("slides captions and their words back by the trim", () => {
    const shifted = shiftSegments(segments, 1.5);
    expect(shifted).toHaveLength(1);
    expect(shifted[0].start).toBeCloseTo(0.1);
    expect(shifted[0].end).toBeCloseTo(1.5);
    expect(shifted[0].words.map((w) => w.text)).toEqual(["so", "here"]);
    expect(shifted[0].words[0].start).toBeCloseTo(0.1);
  });

  it("clamps a segment straddling the cut to the new start instead of a negative time", () => {
    const shifted = shiftSegments([seg("c", 0.5, 4, [["word", 0.5, 4]])], 1.5);
    expect(shifted[0].start).toBe(0);
    expect(shifted[0].words[0].start).toBe(0);
    expect(shifted[0].end).toBeCloseTo(2.5);
  });
});
