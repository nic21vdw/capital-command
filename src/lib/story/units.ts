import { norm } from "@/lib/story/cleanup";
import type { Word } from "@/lib/story/types";

export type RawUnit = { id: string; firstWord: number; lastWord: number; start: number; end: number; text: string };

export const UNIT_BREAK_GAP_SEC = 1.2;
export const UNIT_MAX_SEC = 28;
const MIN_UNIT_WORDS = 4;

function endsSentence(word: string): boolean {
  return /[.!?…]["')\]]?$/.test(word);
}

export function splitUnits(words: Word[]): RawUnit[] {
  const spans: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const gap = i + 1 < words.length ? words[i + 1].s - words[i].e : Infinity;
    const long = words[i].e - words[start].s > UNIT_MAX_SEC && (/[,;:]$/.test(words[i].w) || gap > 0.35);
    if (endsSentence(words[i].w) || gap >= UNIT_BREAK_GAP_SEC || long || i === words.length - 1) {
      spans.push([start, i]);
      start = i + 1;
    }
  }

  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    const count = span[1] - span[0] + 1;
    const gapToPrevious = previous ? words[span[0]].s - words[previous[1]].e : Infinity;
    if (previous && count < MIN_UNIT_WORDS && gapToPrevious < UNIT_BREAK_GAP_SEC) previous[1] = span[1];
    else merged.push([span[0], span[1]]);
  }

  return merged.map(([first, last], index) => ({
    id: `u${String(index + 1).padStart(4, "0")}`,
    firstWord: first,
    lastWord: last,
    start: words[first].s,
    end: words[last].e,
    text: words
      .slice(first, last + 1)
      .map((word) => word.w)
      .join(" ")
  }));
}

const CONTENT_STOP = new Set([
  "the", "a", "an", "and", "or", "but", "so", "to", "of", "in", "on", "at", "for", "is", "it", "that", "this",
  "i", "you", "we", "they", "he", "she", "be", "was", "were", "are", "am", "like", "just", "um", "uh", "yeah",
  "okay", "ok", "gonna", "going", "do", "did", "it's", "that's", "i'm", "with", "what", "know", "my", "me"
]);

export function contentTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map(norm)
    .filter((token) => token.length > 1 && !CONTENT_STOP.has(token));
}

export function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

export type RetakeCandidate = { id: string; start: number; end: number; text: string; combined: number };

export function findRetakeGroups(units: RetakeCandidate[], windowSec = 90, threshold = 0.5): string[][] {
  const tokens = new Map(units.map((unit) => [unit.id, contentTokens(unit.text)]));
  const parent = new Map(units.map((unit) => [unit.id, unit.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (let i = 0; i < units.length; i++) {
    const a = tokens.get(units[i].id)!;
    if (a.length < 4) continue;
    for (let j = i + 1; j < units.length && units[j].start - units[i].end <= windowSec; j++) {
      const b = tokens.get(units[j].id)!;
      if (b.length < 4) continue;
      const opening = jaccard(a.slice(0, 6), b.slice(0, 6));
      if (jaccard(a, b) >= threshold || (opening >= 0.66 && Math.min(a.length, b.length) >= 5)) {
        parent.set(find(units[j].id), find(units[i].id));
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const unit of units) {
    const root = find(unit.id);
    groups.set(root, [...(groups.get(root) ?? []), unit.id]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function bestTake(group: string[], units: Map<string, RetakeCandidate>): string {
  return [...group].sort((a, b) => {
    const diff = (units.get(b)?.combined ?? 0) - (units.get(a)?.combined ?? 0);
    return Math.abs(diff) > 1e-9 ? diff : (units.get(b)?.start ?? 0) - (units.get(a)?.start ?? 0);
  })[0];
}
