import { describe, expect, it } from "vitest";
import { HOOK_PASS_SCORE, bestColdOpen, reviewHook, transcriptSentences } from "@/lib/longform/hook-review";
import type { CaptionSegment } from "@/types/domain";

function caption(id: string, start: number, end: number, text: string): CaptionSegment {
  const words = text.split(/\s+/).filter(Boolean);
  const step = (end - start) / Math.max(1, words.length);
  return {
    id,
    start,
    end,
    text,
    enabled: true,
    words: words.map((word, index) => ({
      text: word,
      start: start + index * step,
      end: start + (index + 1) * step
    }))
  };
}

describe("reviewHook", () => {
  it("passes an opening that makes a promise and stands on its own", () => {
    const transcript = [
      caption("a", 0, 14, "Here is the biggest mistake you are making with your first product."),
      caption("b", 14, 30, "I lost three months to it and I want you to skip that entirely today.")
    ];
    const review = reviewHook(transcript, 0, 30);
    expect(review.verdict).toBe("strong");
    expect(review.score).toBeGreaterThanOrEqual(HOOK_PASS_SCORE);
    expect(review.opening.length).toBeGreaterThan(0);
    expect(review.coldOpen).toBeUndefined();
  });

  it("flags an opening that starts on filler and refers back to nothing", () => {
    const transcript = [
      caption("a", 0, 16, "um so yeah anyway it was basically that thing again from before"),
      caption("b", 16, 30, "and then that other one too which is kind of the same as it")
    ];
    const review = reviewHook(transcript, 0, 30);
    expect(review.verdict).toBe("weak");
    expect(review.score).toBeLessThan(HOOK_PASS_SCORE);
    expect(review.reasons.length).toBeGreaterThan(0);
  });

  it("offers the strongest later line as a cold open when the opening is weak", () => {
    const transcript = [
      caption("a", 0, 16, "um so yeah anyway it was basically that thing again from before"),
      caption("b", 16, 30, "and then that other one too which is kind of the same as it"),
      caption("c", 60, 74, "Here is the biggest mistake you will make with your first ten customers."),
      caption("d", 74, 88, "so anyway that is roughly where we ended up on the whole thing")
    ];
    const review = reviewHook(transcript, 0, 30);
    expect(review.verdict).toBe("weak");
    expect(review.coldOpen).toBeDefined();
    expect(review.coldOpen!.text.toLowerCase()).toContain("biggest mistake");
    expect(review.coldOpen!.start).toBeGreaterThanOrEqual(30);
    expect(review.coldOpen!.score).toBeGreaterThan(review.score);
  });

  it("never suggests a cold open from inside the hook window itself", () => {
    const transcript = [
      caption("a", 0, 10, "um so yeah anyway it was basically that thing from before"),
      caption("b", 10, 30, "Here is the biggest mistake you are making with your very first product.")
    ];
    const review = reviewHook(transcript, 0, 30);
    if (review.coldOpen) expect(review.coldOpen.start).toBeGreaterThanOrEqual(30);
  });

  it("says unknown rather than weak when nothing was transcribed", () => {
    expect(reviewHook([], 0, 30).verdict).toBe("unknown");
    expect(reviewHook([caption("a", 120, 140, "much later")], 0, 30).verdict).toBe("unknown");
  });

  it("re-scores against the window it was given, not always the opening", () => {
    const transcript = [
      caption("a", 0, 20, "um so yeah anyway basically it is that thing again from earlier"),
      caption("b", 40, 70, "Here is the biggest mistake you are making with your first product today.")
    ];
    expect(reviewHook(transcript, 0, 20).verdict).toBe("weak");
    expect(reviewHook(transcript, 40, 70).verdict).toBe("strong");
  });
});

describe("transcriptSentences", () => {
  it("splits on sentence ends and drops fragments too short to open with", () => {
    const transcript = [
      caption("a", 0, 10, "This is a full sentence with plenty of words in it."),
      caption("b", 10, 12, "Yes."),
      caption("c", 12, 22, "And here is another complete sentence to pull forward.")
    ];
    const sentences = transcriptSentences(transcript);
    expect(sentences).toHaveLength(2);
    expect(sentences[0].start).toBeCloseTo(0, 1);
    expect(sentences[1].end).toBeLessThanOrEqual(22.01);
  });
});

describe("bestColdOpen", () => {
  it("returns nothing when no later line clears the current opening", () => {
    const transcript = [
      caption("a", 0, 14, "Here is the biggest mistake you are making with your first product."),
      caption("b", 40, 54, "so anyway that is roughly where we ended up on the whole thing")
    ];
    expect(bestColdOpen(transcript, 0, 30, 95)).toBeUndefined();
  });
});
