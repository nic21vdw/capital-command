import type { KeptRange } from "@/lib/longform/plan";
import type { CaptionSegment, CaptionWord } from "@/types/domain";

// ----- Filler words and the space between words -----
// Silence detection only finds pauses quiet enough to read as silence. An
// "um", a stutter or a long breath between two words is not quiet, so it
// survives the dead-space cut and is exactly what makes a stream edit sound
// like a stream. These cuts are made from the word timings instead:
//
// - FILLERS: the standalone sounds that never carry meaning. Words like "like",
//   "so" and "you know" are left alone: they mean something often enough that
//   cutting them would cut sentences.
// - STUTTERS: the same word twice in a row ("I I think", "the the"), where the
//   first one goes.
// - GAPS: a pause between two words that is longer than a beat, tightened to a
//   beat. Whisper often leaves an "um" out of the transcript altogether, so the
//   gap it leaves is the only trace of it.
//
// Every cut is carved from between word edges with a little air kept on both
// sides, so no cut can clip the word next to it. Pure, so it is tested
// directly.

const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mhm", "eh"]);

/** A pause between two words longer than this is tightened. */
const GAP_TRIGGER_SEC = 0.45;
/** Air kept after the word before a cut and before the word after it. */
const KEEP_AFTER_SEC = 0.1;
const KEEP_BEFORE_SEC = 0.08;
/** Air kept against the kept words when a whole word is cut out. */
const TIGHT_SEC = 0.03;
/** A cut shorter than this is not worth a jump. */
const MIN_CUT_SEC = 0.18;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9']/g, "");
}

export function isFillerWord(text: string): boolean {
  return FILLERS.has(normalize(text));
}

function wordsIn(transcript: CaptionSegment[], window: KeptRange): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const segment of transcript) {
    if (segment.end <= window.start || segment.start >= window.end) continue;
    for (const word of segment.words) {
      if (!word.text.trim()) continue;
      if (word.start >= window.start - 0.001 && word.end <= window.end + 0.001) words.push(word);
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

export type FillerCut = KeptRange & { reason: "filler" | "stutter" | "gap" };

/**
 * Every filler, stutter and over-long gap inside the windows, as ranges to
 * cut. The ranges never overlap and never touch a kept word.
 */
export function planFillerCuts(transcript: CaptionSegment[], windows: KeptRange[]): FillerCut[] {
  const cuts: FillerCut[] = [];
  for (const window of windows) {
    const words = wordsIn(transcript, window);
    // Decide which words go first, then cut the runs between the kept ones.
    const drop = words.map((word, index) => {
      if (isFillerWord(word.text)) return "filler" as const;
      const next = words[index + 1];
      const token = normalize(word.text);
      if (next && token && token === normalize(next.text) && next.start - word.end < 0.6) return "stutter" as const;
      return null;
    });

    let previousKept: CaptionWord | null = null;
    let pendingReason: FillerCut["reason"] | null = null;
    let firstDropped: CaptionWord | null = null;
    for (let index = 0; index < words.length; index += 1) {
      const reason = drop[index];
      if (reason) {
        pendingReason ??= reason;
        firstDropped ??= words[index];
        continue;
      }
      const word = words[index];
      if (previousKept && pendingReason && firstDropped) {
        // A word is coming out: cut tight to it, keeping only a sliver of air
        // against the kept words either side.
        const start = Math.max(previousKept.end + TIGHT_SEC, firstDropped.start - TIGHT_SEC);
        const end = word.start - TIGHT_SEC;
        if (end - start >= MIN_CUT_SEC) cuts.push({ start: round3(start), end: round3(end), reason: pendingReason });
      } else if (previousKept) {
        const start = previousKept.end + KEEP_AFTER_SEC;
        const end = word.start - KEEP_BEFORE_SEC;
        if (word.start - previousKept.end >= GAP_TRIGGER_SEC && end - start >= MIN_CUT_SEC) {
          cuts.push({ start: round3(start), end: round3(end), reason: "gap" });
        }
      } else if (pendingReason) {
        // Fillers before the first kept word: the passage starts on the word instead.
        const start = window.start;
        const end = word.start - KEEP_BEFORE_SEC;
        if (end - start >= MIN_CUT_SEC) cuts.push({ start: round3(start), end: round3(end), reason: pendingReason });
      }
      previousKept = word;
      pendingReason = null;
      firstDropped = null;
    }
  }
  return cuts;
}

// ----- Clean in-points -----
// A passage lifted out of a stream usually starts on a run-up: "so", "okay",
// "alright so", "and yeah". An editor starts the shot on the first word that
// means something.

const RUN_UP = new Set([
  ...FILLERS,
  "so",
  "and",
  "okay",
  "ok",
  "alright",
  "yeah",
  "well",
  "anyway"
]);

/** Where a passage should really start: its first word that is not a run-up. */
export function cleanInPoint(transcript: CaptionSegment[], window: KeptRange): number {
  const words = wordsIn(transcript, window);
  let index = 0;
  // Never trim more than three words or a quarter of the passage.
  while (index < Math.min(3, words.length - 1) && RUN_UP.has(normalize(words[index].text))) index += 1;
  if (index === 0) return window.start;
  const start = words[index].start - KEEP_BEFORE_SEC;
  if (start - window.start > (window.end - window.start) / 4) return window.start;
  return round3(Math.max(window.start, start));
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
