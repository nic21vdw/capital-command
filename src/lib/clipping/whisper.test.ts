import { describe, expect, it } from "vitest";
import { clampWordsToDuration, offsetWordChunks, wordsFromChunks, type WordChunk } from "./whisper";

describe("wordsFromChunks", () => {
  it("keeps words in spoken order even when a timestamp jumps backwards", () => {
    // Whisper can emit a word whose raw start precedes the previous word at a
    // 30s chunk boundary. The transcript order must win over the raw start.
    const chunks: WordChunk[] = [
      { text: " one", timestamp: [1.0, 1.4] },
      { text: " two", timestamp: [1.4, 1.8] },
      { text: " three", timestamp: [0.2, 0.6] } // stray backwards timestamp
    ];
    const words = wordsFromChunks(chunks);
    expect(words.map((w) => w.text)).toEqual(["one", "two", "three"]);
    // Starts are clamped to be non-decreasing.
    expect(words[2].start).toBeGreaterThanOrEqual(words[1].start);
  });

  it("closes an inflated word end against the next word so nothing overlaps", () => {
    const chunks: WordChunk[] = [
      { text: " hello", timestamp: [0, 5] }, // absurdly long end
      { text: " there", timestamp: [1, 1.4] }
    ];
    const words = wordsFromChunks(chunks);
    expect(words[0].end).toBeCloseTo(1); // trimmed down to the next word's start
    expect(words[0].end).toBeLessThanOrEqual(words[1].start);
  });

  it("fills a missing end with a bounded fallback duration", () => {
    const chunks: WordChunk[] = [{ text: " solo", timestamp: [2, null] }];
    const words = wordsFromChunks(chunks);
    expect(words[0].start).toBeCloseTo(2);
    expect(words[0].end).toBeGreaterThan(words[0].start);
    expect(words[0].end - words[0].start).toBeLessThanOrEqual(0.5);
  });

  it("drops a forward-spiked hallucination stamp instead of ratcheting later words past it", () => {
    // Whisper hallucinates a word during silence and stamps it at the far edge
    // of its 30s chunk, way ahead of the surrounding speech. The words after it
    // must keep their own (correct) timing instead of being clamped forward.
    const chunks: WordChunk[] = [
      { text: " a", timestamp: [10.0, 10.4] },
      { text: " b", timestamp: [10.5, 10.9] },
      { text: " uh", timestamp: [45.0, 45.2] }, // hallucinated, stamped at chunk end
      { text: " c", timestamp: [11.0, 11.4] },
      { text: " d", timestamp: [11.5, 11.9] },
      { text: " e", timestamp: [12.0, 12.4] }
    ];
    const words = wordsFromChunks(chunks);
    expect(words.map((w) => w.text)).toEqual(["a", "b", "uh", "c", "d", "e"]);
    // The spiked word snaps back next to its neighbours...
    expect(words[2].start).toBeCloseTo(10.9);
    // ...and the real words after it keep their own starts.
    expect(words[3].start).toBeCloseTo(11.0);
    expect(words[5].start).toBeCloseTo(12.0);
  });

  it("does not let repeated silence hallucinations accumulate into a growing desync", () => {
    // Two spikes minutes apart — the second must not stack on top of the first.
    const chunks: WordChunk[] = [
      { text: " one", timestamp: [5.0, 5.3] },
      { text: " oops", timestamp: [30.0, 30.2] },
      { text: " two", timestamp: [5.6, 5.9] },
      { text: " three", timestamp: [6.1, 6.4] },
      { text: " four", timestamp: [6.6, 6.9] },
      { text: " again", timestamp: [60.0, 60.2] },
      { text: " five", timestamp: [7.1, 7.4] },
      { text: " six", timestamp: [7.6, 7.9] },
      { text: " seven", timestamp: [8.1, 8.4] }
    ];
    const words = wordsFromChunks(chunks);
    expect(words[words.length - 1].start).toBeCloseTo(8.1);
    expect(words.map((w) => w.start).every((s) => s < 10)).toBe(true);
  });

  it("keeps real timestamps across a genuine long pause", () => {
    // A minute of legitimate silence: the word before the pause is not a spike,
    // because the words after it start later, not earlier.
    const chunks: WordChunk[] = [
      { text: " before", timestamp: [100.0, 100.3] },
      { text: " after", timestamp: [160.0, 160.3] },
      { text: " the", timestamp: [160.5, 160.7] },
      { text: " pause", timestamp: [160.9, 161.2] }
    ];
    const words = wordsFromChunks(chunks);
    expect(words[0].start).toBeCloseTo(100.0);
    expect(words[1].start).toBeCloseTo(160.0);
  });

  it("skips empty tokens and never emits a zero-or-negative duration", () => {
    const chunks: WordChunk[] = [
      { text: "  ", timestamp: [0, 0.5] },
      { text: " word", timestamp: [0.5, 0.5] }
    ];
    const words = wordsFromChunks(chunks);
    expect(words).toHaveLength(1);
    expect(words[0].end).toBeGreaterThan(words[0].start);
  });
});

describe("offsetWordChunks", () => {
  it("shifts start and end from window-relative to source time", () => {
    const chunks: WordChunk[] = [
      { text: " hello", timestamp: [0.2, 0.6] },
      { text: " world", timestamp: [0.7, 1.1] }
    ];
    expect(offsetWordChunks(chunks, 600)).toEqual([
      { text: " hello", timestamp: [600.2, 600.6] },
      { text: " world", timestamp: [600.7, 601.1] }
    ]);
  });

  it("preserves a missing end timestamp as null", () => {
    const chunks: WordChunk[] = [{ text: " tail", timestamp: [29.5, null] }];
    expect(offsetWordChunks(chunks, 1200)).toEqual([{ text: " tail", timestamp: [1229.5, null] }]);
  });

  it("returns the input untouched for a zero offset", () => {
    const chunks: WordChunk[] = [{ text: " hi", timestamp: [0, 0.3] }];
    expect(offsetWordChunks(chunks, 0)).toBe(chunks);
  });

  it("keeps words from consecutive decode windows monotonic for caption building", () => {
    const windowOne: WordChunk[] = [{ text: " first", timestamp: [599.4, 599.9] }];
    const windowTwo = offsetWordChunks([{ text: " second", timestamp: [0.1, 0.5] }], 600);
    const words = wordsFromChunks([...windowOne, ...windowTwo]);
    expect(words.map((w) => w.text)).toEqual(["first", "second"]);
    expect(words[1].start).toBeCloseTo(600.1, 3);
    expect(words[0].end).toBeLessThanOrEqual(words[1].start);
  });
});

describe("wordsFromChunks hyphen and contraction joining", () => {
  it("joins a token that opens with a hyphen onto the word before it", () => {
    // The model splits "push-ups" into two tokens and every consumer re-joins
    // tokens with a space, which burned "push -ups" into finished captions.
    const words = wordsFromChunks([
      { text: " 75", timestamp: [1.0, 1.3] },
      { text: " push", timestamp: [1.3, 1.6] },
      { text: "-ups", timestamp: [1.6, 1.9] }
    ]);
    expect(words.map((w) => w.text)).toEqual(["75", "push-ups"]);
    expect(words[1].end).toBeCloseTo(1.9);
  });

  it("joins a contraction tail onto its word", () => {
    const words = wordsFromChunks([
      { text: " it", timestamp: [0, 0.2] },
      { text: "'s", timestamp: [0.2, 0.3] },
      { text: " done", timestamp: [0.3, 0.6] }
    ]);
    expect(words.map((w) => w.text)).toEqual(["it's", "done"]);
  });

  it("leaves an ordinary word untouched", () => {
    const words = wordsFromChunks([
      { text: " well", timestamp: [0, 0.3] },
      { text: " known", timestamp: [0.3, 0.6] }
    ]);
    expect(words.map((w) => w.text)).toEqual(["well", "known"]);
  });
});

describe("clampWordsToDuration", () => {
  it("drops a word stamped past the end of the media", () => {
    const words = clampWordsToDuration(
      [
        { text: "hello", start: 1, end: 1.4 },
        { text: "ringing", start: 28.06, end: 29.92 }
      ],
      25
    );
    expect(words.map((w) => w.text)).toEqual(["hello"]);
  });

  it("trims the word that straddles the end instead of dropping it", () => {
    const words = clampWordsToDuration([{ text: "end", start: 24.8, end: 26.4 }], 25);
    expect(words).toHaveLength(1);
    expect(words[0].end).toBeCloseTo(25.5);
  });

  it("leaves everything alone when the duration is unknown", () => {
    const words = [{ text: "a", start: 0, end: 1 }];
    expect(clampWordsToDuration(words, 0)).toEqual(words);
  });
});
