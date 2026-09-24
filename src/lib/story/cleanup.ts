import type { CleanupKind, Removal, Word } from "@/lib/story/types";

export const PURE_FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "hmm", "hm", "mm", "mhm", "eh"]);

const LIKE_AS_VERB_BEFORE = new Set([
  "i", "you", "we", "they", "he", "she", "would", "don't", "didn't", "do", "does", "did", "doesn't",
  "looks", "look", "looked", "looking", "feel", "feels", "felt", "feeling", "seems", "seem", "seemed",
  "sounds", "sound", "sounded", "something", "anything", "nothing", "more", "less", "exactly"
]);

const LIKE_AFTER_LINKING = new Set(["was", "is", "be", "it's", "that's", "what's", "just", "really", "people", "kind", "sort", "stuff", "things"]);

const YOU_KNOW_OBJECTS = new Set([
  "what", "how", "that", "the", "why", "when", "where", "if", "it", "this", "about", "who", "a", "an",
  "them", "him", "her", "me", "us", "your", "my", "whether", "which", "what's", "that's", "i", "you", "exactly"
]);

const STOPWORDS = new Set(["the", "a", "an", "of", "to", "and", "in", "is", "it", "on", "for", "that", "this", "i"]);

export function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9'$%]/g, "");
}

function trailingPause(word: string): boolean {
  return /[,;:.!?…—–]$/.test(word) || /-$/.test(word);
}

function gapAfter(words: Word[], i: number): number {
  return i + 1 < words.length ? words[i + 1].s - words[i].e : Infinity;
}

function gapBefore(words: Word[], i: number): number {
  return i > 0 ? words[i].s - words[i - 1].e : Infinity;
}

export function isFillerLike(words: Word[], i: number): boolean {
  if (norm(words[i].w) !== "like") return false;
  const previousRaw = i > 0 ? words[i - 1].w : "";
  const previous = norm(previousRaw);
  if (i > 0 && /,$/.test(previousRaw)) return true;
  if (LIKE_AS_VERB_BEFORE.has(previous)) return false;
  if (trailingPause(words[i].w)) return true;
  if (LIKE_AFTER_LINKING.has(previous)) return false;
  return gapBefore(words, i) >= 0.3 || gapAfter(words, i) >= 0.3;
}

export function isFillerYouKnow(words: Word[], i: number): boolean {
  if (i + 1 >= words.length) return false;
  if (norm(words[i].w) !== "you" || norm(words[i + 1].w) !== "know") return false;
  const next = i + 2 < words.length ? norm(words[i + 2].w) : "";
  if (YOU_KNOW_OBJECTS.has(next) && !trailingPause(words[i + 1].w)) return false;
  const before = i === 0 || /[,.!?]$/.test(words[i - 1].w) || gapBefore(words, i) >= 0.3;
  const after = trailingPause(words[i + 1].w) || gapAfter(words, i + 1) >= 0.3 || next === "";
  return before || after;
}

function isInterjection(words: Word[], i: number): boolean {
  return /-oh/i.test(words[i].w) || /^-oh/i.test(words[i + 1]?.w ?? "");
}

function isFragment(word: string): boolean {
  return /[-—–]$/.test(word.trim()) && norm(word).length <= 6;
}

function sameWords(words: Word[], a: number, b: number, n: number): boolean {
  for (let k = 0; k < n; k++) {
    if (norm(words[a + k].w) !== norm(words[b + k].w)) return false;
  }
  return true;
}

function allStopwords(words: Word[], start: number, n: number): boolean {
  for (let k = 0; k < n; k++) if (!STOPWORDS.has(norm(words[start + k].w))) return false;
  return true;
}

export type WordFlag = { index: number; kind: Exclude<CleanupKind, "silence"> };

export function detectDisfluencies(words: Word[]): WordFlag[] {
  const flags = new Map<number, Exclude<CleanupKind, "silence">>();
  const flag = (index: number, kind: Exclude<CleanupKind, "silence">) => {
    if (!flags.has(index)) flags.set(index, kind);
  };

  for (let i = 0; i < words.length; i++) {
    const current = norm(words[i].w);
    if (PURE_FILLERS.has(current) && !isInterjection(words, i)) flag(i, "filler");
    else if (isFillerLike(words, i)) flag(i, "filler");
    else if (isFillerYouKnow(words, i)) {
      flag(i, "filler");
      flag(i + 1, "filler");
    }
  }

  for (let i = 0; i + 1 < words.length; i++) {
    if (flags.has(i)) continue;
    const current = norm(words[i].w);
    const next = norm(words[i + 1].w);
    if (!current || !next) continue;
    const close = words[i + 1].s - words[i].e < 0.6;
    if (!close) continue;
    if (current === next && !["that", "had", "is"].includes(current) && !/^[.\-%]/.test(words[i + 1].w.trim()) && !/^\d+$/.test(current)) flag(i, "stutter");
    else if (isFragment(words[i].w) || (current.length < next.length && next.startsWith(current) && current.length <= 3 && /-$/.test(words[i].w)))
      flag(i, "false-start");
  }

  for (let d = 1; d < words.length - 1; d++) {
    if (!/^[-–—]+$/.test(words[d].w.trim())) continue;
    for (let n = 3; n >= 1; n--) {
      if (d - n < 0 || d + n >= words.length) continue;
      let same = true;
      for (let k = 0; k < n; k++) if (norm(words[d - n + k].w) !== norm(words[d + 1 + k].w) || !norm(words[d + 1 + k].w)) same = false;
      if (!same) continue;
      for (let k = d - n; k <= d; k++) flag(k, "repeat");
      break;
    }
  }

  for (let n = 5; n >= 2; n--) {
    for (let i = 0; i + 2 * n <= words.length; i++) {
      if (flags.has(i)) continue;
      if (!sameWords(words, i, i + n, n)) continue;
      if (allStopwords(words, i, n)) continue;
      if (words[i + n].s - words[i + n - 1].e > 1.5) continue;
      for (let k = 0; k < n; k++) flag(i + k, "repeat");
    }
  }

  for (let i = 0; i + 4 < words.length; i++) {
    if (flags.has(i)) continue;
    for (let j = i + 2; j <= Math.min(i + 7, words.length - 2); j++) {
      if (!sameWords(words, i, j, 2) || allStopwords(words, i, 2)) continue;
      if (j - i === 2) break;
      const restartGap = words[j].s - words[j - 1].e;
      const span = words[j].s - words[i].s;
      if (span > 4 || (restartGap < 0.15 && !/[-—–,]$/.test(words[j - 1].w))) continue;
      for (let k = i; k < j; k++) flag(k, "false-start");
      break;
    }
  }

  return [...flags.entries()].sort((a, b) => a[0] - b[0]).map(([index, kind]) => ({ index, kind }));
}

export type CleanupOptions = {
  maxGapSec: number;
  targetGapSec: number;
  dramaticGapSec: number;
  padSec: number;
};

export const DEFAULT_CLEANUP: CleanupOptions = {
  maxGapSec: 0.4,
  targetGapSec: 0.3,
  dramaticGapSec: 0.6,
  padSec: 0.05
};

export type KeepRange = { start: number; end: number; firstWord: number; lastWord: number };

export type CleanupResult = { ranges: KeepRange[]; removals: Removal[] };

export function cleanRange(
  words: Word[],
  firstWord: number,
  lastWord: number,
  flagged: Map<number, Exclude<CleanupKind, "silence">>,
  dramaticAfter: Set<number> = new Set(),
  options: CleanupOptions = DEFAULT_CLEANUP
): CleanupResult {
  const removals: Removal[] = [];
  const ranges: KeepRange[] = [];
  let open: KeepRange | null = null;
  let previousKept = -1;

  const close = (range: KeepRange, nextStart: number | null) => {
    const last = words[range.lastWord];
    const room = nextStart === null ? options.padSec : Math.max(0, (nextStart - last.e) / 2);
    range.end = last.e + Math.min(options.padSec, room);
    ranges.push(range);
  };

  for (let i = firstWord; i <= lastWord; i++) {
    const kind = flagged.get(i);
    if (kind) {
      removals.push({ start: words[i].s, end: words[i].e, kind, text: words[i].w });
      continue;
    }
    if (open && previousKept >= 0) {
      const gap = words[i].s - words[previousKept].e;
      const removedBetween = i - previousKept > 1;
      const allowed = dramaticAfter.has(previousKept) ? options.dramaticGapSec : options.maxGapSec;
      if (removedBetween || gap > allowed) {
        const keepGap = removedBetween
          ? Math.min(gap, options.targetGapSec)
          : dramaticAfter.has(previousKept)
            ? Math.min(gap, options.dramaticGapSec)
            : options.targetGapSec;
        const tail = Math.min(keepGap / 2, Math.max(0, (words[previousKept + 1]?.s ?? words[i].s) - words[previousKept].e));
        const lead = Math.min(keepGap - tail, Math.max(0, words[i].s - (words[i - 1]?.e ?? words[i].s)));
        open.end = words[previousKept].e + tail;
        ranges.push(open);
        if (!removedBetween && gap - tail - lead > 0.01) {
          removals.push({ start: open.end, end: words[i].s - lead, kind: "silence", text: "" });
        }
        open = { start: words[i].s - lead, end: words[i].e, firstWord: i, lastWord: i };
        previousKept = i;
        continue;
      }
    }
    if (!open) {
      const room = i > 0 ? Math.max(0, words[i].s - words[i - 1].e) : options.padSec;
      open = { start: words[i].s - Math.min(options.padSec, i > firstWord ? room / 2 : room), end: words[i].e, firstWord: i, lastWord: i };
    }
    open.lastWord = i;
    previousKept = i;
  }
  if (open) close(open, lastWord + 1 < words.length ? words[lastWord + 1].s : null);
  return { ranges: ranges.map((range) => ({ ...range, start: Math.max(0, range.start) })), removals };
}

export function snapToQuiet(time: number, envelope: Float32Array | null, hopSec: number, low: number, high: number): number {
  if (!envelope || envelope.length === 0) return time;
  const from = Math.max(0, Math.floor(Math.max(low, time - 0.06) / hopSec));
  const to = Math.min(envelope.length - 1, Math.ceil(Math.min(high, time + 0.06) / hopSec));
  if (to <= from) return time;
  let best = Math.round(time / hopSec);
  let bestValue = Infinity;
  for (let k = from; k <= to; k++) {
    const distance = Math.abs(k * hopSec - time) * 0.02;
    const value = envelope[k] + distance;
    if (value < bestValue) {
      bestValue = value;
      best = k;
    }
  }
  return Math.min(high, Math.max(low, best * hopSec));
}

export function fillerIndices(words: Word[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if ((PURE_FILLERS.has(norm(words[i].w)) && !isInterjection(words, i)) || isFillerLike(words, i)) hits.push(i);
    else if (isFillerYouKnow(words, i)) {
      hits.push(i);
      i++;
    }
  }
  return hits;
}

export function countFillers(words: Word[]): number {
  return fillerIndices(words).length;
}
