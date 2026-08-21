import { analyzeTranscript, densityScore } from "@/lib/clipping/text-signals";
import type { LongformHookReview } from "@/lib/longform/types";
import type { CaptionSegment, CaptionWord } from "@/types/domain";

// Reviews the opening block of a long-form recording: does the first thing
// said actually grab attention? The scoring is the same content analysis the
// short-form clip ranker uses, so a strong long-form opening and a strong clip
// opening mean the same thing. Pure and side-effect free.

/** Below this the opening is flagged instead of quietly shipping. */
export const HOOK_PASS_SCORE = 60;

/** A cold open only gets offered when it clears the opening by this much. */
const COLD_OPEN_MARGIN = 12;

/** How far into the recording the cold-open search reads. */
const COLD_OPEN_SEARCH_SEC = 15 * 60;

const MAX_SENTENCE_WORDS = 26;
const MIN_SENTENCE_WORDS = 5;
const SENTENCE_END = /[.!?]["')\]]?$/;

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/** Blends the opening's content signals into one 0-100 strength. */
function blend(signals: ReturnType<typeof analyzeTranscript>): number {
  return Math.round(
    signals.hook * 0.6 + signals.standalone * 0.2 + densityScore(signals.wordsPerSecond) * 0.2
  );
}

function allWords(transcript: CaptionSegment[]): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const segment of transcript) {
    if (segment.words.length > 0) {
      for (const word of segment.words) if (word.text.trim()) words.push(word);
      continue;
    }
    const tokens = segment.text.split(/\s+/).filter(Boolean);
    const step = (segment.end - segment.start) / Math.max(1, tokens.length);
    tokens.forEach((token, index) => {
      words.push({ text: token, start: segment.start + index * step, end: segment.start + (index + 1) * step });
    });
  }
  return words.sort((a, b) => a.start - b.start);
}

type Sentence = { text: string; start: number; end: number };

/** Splits the transcript into sentence-ish spans a cold open could be pulled from. */
export function transcriptSentences(transcript: CaptionSegment[], limitSec = COLD_OPEN_SEARCH_SEC): Sentence[] {
  const words = allWords(transcript).filter((word) => word.start < limitSec);
  const sentences: Sentence[] = [];
  let current: CaptionWord[] = [];
  const flush = () => {
    if (current.length < MIN_SENTENCE_WORDS) {
      current = [];
      return;
    }
    sentences.push({
      text: current.map((word) => word.text.trim()).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end
    });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    if (SENTENCE_END.test(word.text.trim()) || current.length >= MAX_SENTENCE_WORDS) flush();
  }
  flush();
  return sentences;
}

/**
 * The strongest line in the recording that would work as a cold open — the one
 * sentence worth pulling to the front when the natural opening is weak. Only a
 * suggestion: nothing is reordered until the editor asks for it.
 */
export function bestColdOpen(
  transcript: CaptionSegment[],
  excludeStart: number,
  excludeEnd: number,
  beatScore: number
): LongformHookReview["coldOpen"] | undefined {
  let best: LongformHookReview["coldOpen"] | undefined;
  for (const sentence of transcriptSentences(transcript)) {
    if (sentence.end > excludeStart && sentence.start < excludeEnd) continue;
    if (sentence.end - sentence.start < 1) continue;
    const signals = analyzeTranscript(transcript, sentence.start, sentence.end + 0.001);
    if (!signals.hasText) continue;
    const score = blend(signals);
    if (score < beatScore + COLD_OPEN_MARGIN) continue;
    if (best && score <= best.score) continue;
    best = { text: sentence.text, start: round1(sentence.start), end: round1(sentence.end), score };
  }
  return best;
}

/**
 * Reviews the hook window and says plainly whether the opening earns
 * attention. Returns `unknown` (never "weak") when no transcript covers the
 * window — a missing transcript is not evidence of a bad opening.
 */
export function reviewHook(
  transcript: CaptionSegment[],
  hookStart: number,
  hookEnd: number
): LongformHookReview {
  const start = Math.max(0, hookStart);
  const end = Math.max(start, hookEnd);
  const base = { start: round1(start), end: round1(end) };
  if (end - start < 0.5 || transcript.length === 0) {
    return {
      ...base,
      score: 0,
      verdict: "unknown",
      opening: "",
      reasons: ["No transcript covers the opening, so it could not be reviewed. Watch it back yourself."]
    };
  }

  const signals = analyzeTranscript(transcript, start, end);
  if (!signals.hasText) {
    return {
      ...base,
      score: 0,
      verdict: "unknown",
      opening: "",
      reasons: ["Nothing is spoken in the opening block — the first thing a viewer hears is dead air."]
    };
  }

  const score = blend(signals);
  const reasons: string[] = [];
  for (const note of signals.notes) reasons.push(note);
  if (signals.hook < 45) reasons.push("The opening line makes no promise and asks nothing — there is no reason to stay.");
  if (signals.standalone < 45) reasons.push("The opening leans on context the viewer does not have yet.");
  if (signals.wordsPerSecond < 1.6) reasons.push(`Delivery is slow up front (${signals.wordsPerSecond.toFixed(1)} words/sec).`);
  if (score >= HOOK_PASS_SCORE && reasons.length === 0) {
    reasons.push("The opening states something concrete and lands on its own — it earns the next 30 seconds.");
  }

  const verdict = score >= HOOK_PASS_SCORE ? "strong" : "weak";
  const coldOpen = verdict === "weak" ? bestColdOpen(transcript, start, end, score) : undefined;
  return { ...base, score, verdict, opening: signals.opening, reasons, coldOpen };
}
