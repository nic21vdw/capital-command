import { describe, expect, it } from "vitest";
import { offsetWordChunks, wordsFromChunks, type WordChunk } from "./whisper";

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
