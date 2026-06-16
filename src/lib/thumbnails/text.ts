/**
 * Text helpers for the thumbnail renderer.
 *
 * These are intentionally free of any canvas dependency so they can be unit
 * tested in node: width measurement is injected as a callback. The renderer
 * passes a `ctx.measureText`-backed measurer; tests pass a fake one.
 */

export type Token = {
  text: string;
  /** Drawn in the highlight color instead of the main text color. */
  highlight: boolean;
};

export type Line = Token[];

export type Measure = (text: string) => number;

/**
 * Splits overlay copy into word tokens, honouring `*asterisk*` markup that marks
 * a word or phrase to be drawn in the accent/highlight color.
 *
 * Example: `tokenizeHighlights("the *truth* about money")` yields four tokens
 * with only "truth" flagged as highlighted.
 */
export function tokenizeHighlights(text: string): Token[] {
  const tokens: Token[] = [];
  // Keep the delimited segments so we know which words were inside *...*.
  const segments = text.split(/(\*[^*]+\*)/g);
  for (const segment of segments) {
    if (!segment) continue;
    const highlighted = segment.length > 2 && segment.startsWith("*") && segment.endsWith("*");
    const content = highlighted ? segment.slice(1, -1) : segment;
    for (const word of content.split(/\s+/)) {
      if (word) tokens.push({ text: word, highlight: highlighted });
    }
  }
  return tokens;
}

/** Width of a wrapped line: word widths plus single spaces between them. */
export function lineWidth(line: Line, measure: Measure, space?: number): number {
  const sp = space ?? measure(" ");
  let width = 0;
  line.forEach((token, index) => {
    width += measure(token.text) + (index > 0 ? sp : 0);
  });
  return width;
}

/**
 * Greedy word wrap that preserves per-token highlight flags. A single word that
 * is wider than `maxWidth` still gets its own line rather than being dropped.
 */
export function wrapTokens(tokens: Token[], maxWidth: number, measure: Measure): Line[] {
  const space = measure(" ");
  const lines: Line[] = [];
  let current: Line = [];
  let currentWidth = 0;

  for (const token of tokens) {
    const wordWidth = measure(token.text);
    const added = current.length > 0 ? space + wordWidth : wordWidth;
    if (current.length > 0 && currentWidth + added > maxWidth) {
      lines.push(current);
      current = [token];
      currentWidth = wordWidth;
    } else {
      current.push(token);
      currentWidth += added;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
