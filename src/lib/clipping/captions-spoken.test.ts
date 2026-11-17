import { describe, expect, it } from "vitest";
import { chunkWords, spokenWords, windowSegments } from "@/lib/clipping/captions";
import type { CaptionSegment } from "@/types/domain";

const seg = (start: number, words: [string, number, number][]): CaptionSegment => ({
  id: `s${start}`, enabled: true, start, end: words[words.length - 1][2], text: words.map((w) => w[0]).join(" "), words: words.map(([text, s, e]) => ({ text, start: s, end: e }))
});

describe("spokenWords", () => {
  it("drops standalone fillers from a Short's captions and keeps every real word and its timing", () => {
    const source = [seg(10, [["Um,", 10, 10.3], ["so", 10.4, 10.6], ["this", 10.6, 10.8], ["uh", 10.9, 11.1], ["like", 11.2, 11.4], ["works.", 11.4, 11.9]])];
    const words = spokenWords(windowSegments(source, 10, 20));
    expect(words.map((w) => w.text)).toEqual(["so", "this", "like", "works."]);
    expect(words[0]).toEqual({ text: "so", start: expect.closeTo(0.4, 5), end: expect.closeTo(0.6, 5) });
    expect(chunkWords(words, 7)[0].text).toBe("so this like works.");
  });

  it("leaves the stored transcript alone", () => {
    const source = [seg(0, [["Uh", 0, 0.2], ["hello", 0.3, 0.6]])];
    spokenWords(source);
    expect(source[0].words).toHaveLength(2);
  });
});
