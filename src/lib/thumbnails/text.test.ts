import { describe, expect, it } from "vitest";
import { lineWidth, tokenizeHighlights, wrapTokens, type Token } from "./text";

/** Each character is 10px wide, including the space between words. */
const measure = (value: string) => value.length * 10;

describe("tokenizeHighlights", () => {
  it("splits words and flags only those inside *asterisks*", () => {
    const tokens = tokenizeHighlights("the *truth* about money");
    expect(tokens.map((t) => t.text)).toEqual(["the", "truth", "about", "money"]);
    expect(tokens.map((t) => t.highlight)).toEqual([false, true, false, false]);
  });

  it("flags every word of a multi-word highlight phrase", () => {
    const tokens = tokenizeHighlights("*never again* will this happen");
    expect(tokens.filter((t) => t.highlight).map((t) => t.text)).toEqual(["never", "again"]);
  });

  it("does not treat a lone asterisk as markup", () => {
    const tokens = tokenizeHighlights("buy * sell");
    expect(tokens.map((t) => t.text)).toEqual(["buy", "*", "sell"]);
    expect(tokens.every((t) => !t.highlight)).toBe(true);
  });

  it("yields no tokens for empty or whitespace input", () => {
    expect(tokenizeHighlights("")).toEqual([]);
    expect(tokenizeHighlights("   ")).toEqual([]);
  });
});

describe("wrapTokens", () => {
  it("wraps on the injected measurer", () => {
    const tokens: Token[] = "aa bb cc dd".split(" ").map((text) => ({ text, highlight: false }));
    // Width 70 fits two 2-char words plus one space (20 + 10 + 20) but not three.
    const lines = wrapTokens(tokens, 70, measure);
    expect(lines).toHaveLength(2);
    expect(lines[0].map((t) => t.text)).toEqual(["aa", "bb"]);
    expect(lines[1].map((t) => t.text)).toEqual(["cc", "dd"]);
  });

  it("gives a word wider than the line its own line rather than dropping it", () => {
    const lines = wrapTokens([{ text: "supercalifragilistic", highlight: false }], 50, measure);
    expect(lines).toHaveLength(1);
    expect(lines[0][0].text).toBe("supercalifragilistic");
  });
});

describe("lineWidth", () => {
  it("sums word widths plus single spaces between them", () => {
    const line: Token[] = [
      { text: "aa", highlight: false },
      { text: "bbb", highlight: false }
    ];
    expect(lineWidth(line, measure)).toBe(60);
  });
});
