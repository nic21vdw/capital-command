import assert from "node:assert/strict";
import { lineWidth, tokenizeHighlights, wrapTokens, type Token } from "./text";

// tokenizeHighlights splits words and flags only those inside *asterisks*.
{
  const tokens = tokenizeHighlights("the *truth* about money");
  assert.deepEqual(
    tokens.map((t) => t.text),
    ["the", "truth", "about", "money"]
  );
  assert.deepEqual(
    tokens.map((t) => t.highlight),
    [false, true, false, false]
  );
}

// A multi-word highlight phrase flags every word in the phrase.
{
  const tokens = tokenizeHighlights("*never again* will this happen");
  assert.deepEqual(
    tokens.filter((t) => t.highlight).map((t) => t.text),
    ["never", "again"]
  );
}

// Lone asterisks are not treated as markup.
{
  const tokens = tokenizeHighlights("buy * sell");
  assert.deepEqual(
    tokens.map((t) => t.text),
    ["buy", "*", "sell"]
  );
  assert.equal(tokens.every((t) => !t.highlight), true);
}

// Empty / whitespace input yields no tokens.
assert.deepEqual(tokenizeHighlights(""), []);
assert.deepEqual(tokenizeHighlights("   "), []);

// wrapTokens uses the injected measurer (each char = 10px, space = 10px).
{
  const measure = (s: string) => s.length * 10;
  const tokens: Token[] = "aa bb cc dd".split(" ").map((text) => ({ text, highlight: false }));
  // Width 70 fits two 2-char words + one space (20 + 10 + 20 = 50) but not three.
  const lines = wrapTokens(tokens, 70, measure);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].map((t) => t.text), ["aa", "bb"]);
  assert.deepEqual(lines[1].map((t) => t.text), ["cc", "dd"]);
}

// A single word wider than maxWidth still gets its own line (never dropped).
{
  const measure = (s: string) => s.length * 10;
  const tokens: Token[] = [{ text: "supercalifragilistic", highlight: false }];
  const lines = wrapTokens(tokens, 50, measure);
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0].text, "supercalifragilistic");
}

// lineWidth sums word widths plus single spaces between them.
{
  const measure = (s: string) => s.length * 10;
  const line: Token[] = [
    { text: "aa", highlight: false },
    { text: "bbb", highlight: false }
  ];
  // 20 + 10 (space) + 30 = 60
  assert.equal(lineWidth(line, measure), 60);
}

console.log("thumbnails/text.test.ts passed");
