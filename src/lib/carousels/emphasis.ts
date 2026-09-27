export type EmphasisSpan = { text: string; strong: boolean };

export function emphasisSpans(text: string): EmphasisSpan[] {
  const spans: EmphasisSpan[] = [];
  const pattern = /\*\*([^*]+?)\*\*/g;
  let cursor = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > cursor) spans.push({ text: text.slice(cursor, match.index), strong: false });
    spans.push({ text: match[1], strong: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) spans.push({ text: text.slice(cursor), strong: false });
  return spans.filter((span) => span.text.length > 0);
}

export function plainCopy(text: string | undefined | null): string {
  return emphasisSpans(text ?? "")
    .map((span) => span.text)
    .join("");
}

export type EmphasisPiece = { text: string; strong: boolean };

export function emphasisWords(text: string): EmphasisPiece[][] {
  const words: EmphasisPiece[][] = [];
  let current: EmphasisPiece[] = [];
  for (const span of emphasisSpans(text)) {
    for (const part of span.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (current.length) words.push(current);
        current = [];
        continue;
      }
      current.push({ text: part, strong: span.strong });
    }
  }
  if (current.length) words.push(current);
  return words;
}
