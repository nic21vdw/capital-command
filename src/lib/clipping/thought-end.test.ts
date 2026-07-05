import { describe, expect, it } from "vitest";
import { resolveThoughtEnd, thoughtEndTimes } from "./thought-end";
import type { CaptionSegment } from "@/types/domain";

function seg(start: number, end: number, text: string): CaptionSegment {
  return { id: `s-${start}`, start, end, text, words: [], enabled: true };
}

const OPTIONS = { minEnd: 15, maxEnd: 45, maxExtension: 10, maxTrim: 6 };

describe("thoughtEndTimes", () => {
  it("marks segments that finish a sentence", () => {
    const segments = [
      seg(0, 4, "So here is the thing about"),
      seg(4, 8, "position sizing that nobody tells you."),
      seg(8, 12, "You have to size for the")
    ];
    expect(thoughtEndTimes(segments)).toContain(8);
    expect(thoughtEndTimes(segments)).not.toContain(4);
  });

  it("uses real pauses when the transcript has no punctuation", () => {
    const segments = [
      seg(0, 4, "so here is the thing"),
      seg(4.1, 8, "about position sizing"),
      seg(9.5, 12, "next point entirely")
    ];
    const times = thoughtEndTimes(segments);
    // 8 → followed by a 1.5s gap; 4 → gap of 0.1s is just caption chunking.
    expect(times).toContain(8);
    expect(times).not.toContain(4);
  });

  it("always treats the final spoken segment as a conclusion", () => {
    expect(thoughtEndTimes([seg(0, 5, "trailing words with no punctuation")])).toContain(5);
  });
});

describe("resolveThoughtEnd", () => {
  const segments = [
    seg(0, 6, "Let me explain the biggest mistake new traders make."),
    seg(6, 14, "They risk way too much on a single position"),
    seg(14, 22, "and one bad day wipes out a month of gains."),
    seg(22, 27, "So what should you do instead?"),
    seg(27, 36, "Cap every position at two percent of the account")
  ];

  it("extends a mid-sentence cut forward to where the thought concludes", () => {
    // A cut at 18s lands in the middle of "one bad day wipes out...".
    const result = resolveThoughtEnd(segments, 18, OPTIONS);
    expect(result).toEqual({ end: 22, concluded: true });
  });

  it("extends past the start of a freshly begun sentence to its end", () => {
    // A cut at 24s has just started "So what should you do instead?" —
    // the clip runs longer so the question actually lands.
    const result = resolveThoughtEnd(segments, 24, OPTIONS);
    expect(result).toEqual({ end: 27, concluded: true });
  });

  it("trims back to the previous conclusion when nothing concludes ahead", () => {
    // From 26s the only conclusion ahead within reach is at 27... so block it
    // with a tighter cap: the final segment ends at 36 (> maxEnd 30).
    const result = resolveThoughtEnd(segments, 29, { ...OPTIONS, maxEnd: 30, maxExtension: 4 });
    expect(result).toEqual({ end: 27, concluded: true });
  });

  it("never extends beyond the hard cap", () => {
    const result = resolveThoughtEnd(segments, 29, { ...OPTIONS, maxEnd: 33 });
    // The conclusion at 36 is out of bounds; 27 is the last one inside.
    expect(result.end).toBeLessThanOrEqual(33);
    expect(result).toEqual({ end: 27, concluded: true });
  });

  it("keeps the clip at least its minimum length", () => {
    const result = resolveThoughtEnd(segments, 18, { ...OPTIONS, minEnd: 25 });
    expect(result.end).toBeGreaterThanOrEqual(25);
    expect(result.concluded).toBe(true);
  });

  it("accepts a conclusion a hair before the proposed end", () => {
    // Caption timing jitter: proposal 22.2 vs conclusion 22.0.
    const result = resolveThoughtEnd(segments, 22.2, OPTIONS);
    expect(result).toEqual({ end: 22, concluded: true });
  });

  it("falls back to the clamped proposal when there is no transcript", () => {
    expect(resolveThoughtEnd([], 18, OPTIONS)).toEqual({ end: 18, concluded: false });
    expect(resolveThoughtEnd([], 50, OPTIONS)).toEqual({ end: 45, concluded: false });
  });
});
