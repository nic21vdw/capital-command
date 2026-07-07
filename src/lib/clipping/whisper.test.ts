import { describe, expect, it } from "vitest";
import { wordsFromChunks, type WordChunk } from "./whisper";

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
