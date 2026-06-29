import type { CaptionSegment } from "@/types/domain";

/**
 * Content-derived signals for a single clip, computed from the spoken words
 * that fall inside its time range. These complement the audio-energy scores so
 * the ratings reflect what is actually said, not just how loud it is.
 */
export type TranscriptSignals = {
  /** Whether any spoken words fall inside the clip range. */
  hasText: boolean;
  /** First handful of words, shown to explain the hook score. */
  opening: string;
  /** Spoken words per second across the clip (delivery speed). */
  wordsPerSecond: number;
  /** 0-100 strength of the opening line as a scroll-stopping hook. */
  hook: number;
  /** 0-100 how self-contained the clip is (clean sentence boundaries, no dangling references). */
  standalone: number;
  /** 0-100 emphatic / emotional language. */
  intensity: number;
  /** Short human-readable note about the content, folded into the rationale. */
  notes: string[];
};

const QUESTION_OPENERS = new Set([
  "how", "why", "what", "when", "who", "where", "which", "can", "could",
  "should", "would", "did", "do", "does", "is", "are", "will", "have", "has"
]);

// Words that almost always point back to something said earlier — if a clip
// opens on one of these, it does not stand on its own.
const DANGLING_OPENERS = new Set([
  "this", "that", "these", "those", "it", "they", "them", "he", "she", "his",
  "her", "their", "so", "and", "but", "because", "which", "then", "also",
  "plus", "however", "therefore", "again", "anyway", "basically"
]);

// Filler / throat-clearing openers that make for a weak hook.
const WEAK_OPENERS = new Set([
  "um", "uh", "er", "so", "and", "but", "yeah", "okay", "ok", "like", "well",
  "anyway", "right", "alright"
]);

// Curiosity / stakes words that tend to make an opening line compelling.
const POWER_WORDS = [
  "secret", "never", "nobody", "everyone", "biggest", "most", "worst", "best",
  "mistake", "truth", "reason", "actually", "crazy", "insane", "problem",
  "nobody tells", "here's", "heres", "the thing", "you need", "you have to",
  "stop", "warning", "danger", "shocking", "wrong"
];

// Emphasis words that signal an emotionally intense moment.
const EMPHASIS_WORDS = [
  "really", "very", "so", "absolutely", "literally", "insane", "crazy", "huge",
  "massive", "unbelievable", "incredible", "amazing", "never", "always",
  "everyone", "nobody", "love", "hate", "best", "worst", "perfect", "terrible"
];

const SENTENCE_END = /[.!?]["')\]]?$/;

/** Pulls the words spoken inside [clipStart, clipEnd] in order. */
function wordsInRange(captions: CaptionSegment[], clipStart: number, clipEnd: number): string[] {
  const out: string[] = [];
  for (const seg of captions) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue;
    for (const word of seg.words) {
      if (word.end <= clipStart || word.start >= clipEnd) continue;
      const clean = word.text.trim();
      if (clean) out.push(clean);
    }
    // Some sources only carry phrase-level text; fall back to the segment text.
    if (seg.words.length === 0) {
      for (const token of seg.text.split(/\s+/)) {
        const clean = token.trim();
        if (clean) out.push(clean);
      }
    }
  }
  return out;
}

function clamp(value: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * Scores the transcript of one clip. All sub-scores are 0-100. Returns
 * `hasText: false` (and neutral scores) when no words fall inside the clip, so
 * callers can fall back to audio-only scoring.
 */
export function analyzeTranscript(
  captions: CaptionSegment[],
  clipStart: number,
  clipEnd: number
): TranscriptSignals {
  const words = wordsInRange(captions, clipStart, clipEnd);
  const duration = Math.max(1, clipEnd - clipStart);
  if (words.length < 4) {
    return { hasText: false, opening: "", wordsPerSecond: 0, hook: 0, standalone: 0, intensity: 0, notes: [] };
  }

  const text = words.join(" ");
  const lower = text.toLowerCase();
  const opening = words.slice(0, 12).join(" ");
  const openingLower = words.slice(0, 16).join(" ").toLowerCase();
  const firstWord = words[0].toLowerCase().replace(/[^a-z']/g, "");
  const wordsPerSecond = words.length / duration;
  const notes: string[] = [];

  // --- Hook: how strong is the opening line? -------------------------------
  let hook = 45;
  if (openingLower.includes("?") || QUESTION_OPENERS.has(firstWord)) {
    hook += 18;
    notes.push("opens with a question");
  }
  if (/\b\d/.test(openingLower) || /\b(one|two|three|five|ten|hundred|thousand|million)\b/.test(openingLower)) {
    hook += 12;
  }
  if (/\byou\b|\byour\b/.test(openingLower)) hook += 12;
  if (includesAny(openingLower, POWER_WORDS)) {
    hook += 14;
    notes.push("strong curiosity wording up front");
  }
  if (WEAK_OPENERS.has(firstWord)) {
    hook -= 20;
    notes.push("starts on a filler word");
  }
  hook = clamp(hook);

  // --- Standalone: does it start and finish a complete thought? ------------
  let standalone = 60;
  if (DANGLING_OPENERS.has(firstWord)) {
    standalone -= 28;
    notes.push("opens on a word that refers back to earlier context");
  }
  if (/^[A-Z]/.test(words[0])) standalone += 12;
  else standalone -= 8;
  if (SENTENCE_END.test(text)) standalone += 18;
  else {
    standalone -= 16;
    notes.push("ends mid-sentence");
  }
  // A clip that contains at least one full internal sentence reads as complete.
  if (/[.!?]/.test(text.slice(0, -1))) standalone += 10;
  standalone = clamp(standalone);

  // --- Intensity: emphatic / emotional language ----------------------------
  const exclamations = (text.match(/!/g) || []).length;
  const capsWords = words.filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)).length;
  const emphasisHits = EMPHASIS_WORDS.reduce(
    (sum, w) => sum + (lower.split(new RegExp(`\\b${w}\\b`)).length - 1),
    0
  );
  const per30 = (n: number) => (n / words.length) * 30;
  const intensity = clamp(
    40 + per30(exclamations) * 22 + per30(capsWords) * 14 + per30(emphasisHits) * 10
  );

  return { hasText: true, opening, wordsPerSecond, hook, standalone, intensity, notes };
}

/** Maps spoken words-per-second to a 0-100 word-density score. */
export function densityScore(wordsPerSecond: number): number {
  if (wordsPerSecond <= 0) return 0;
  if (wordsPerSecond < 1.2) return clamp(wordsPerSecond * 42);
  if (wordsPerSecond <= 3.4) return clamp(55 + (wordsPerSecond - 1.2) * 20);
  return clamp(100 - (wordsPerSecond - 3.4) * 16);
}
