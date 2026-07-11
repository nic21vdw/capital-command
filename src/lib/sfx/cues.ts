import { analyzeTranscript } from "@/lib/clipping/text-signals";
import { SFX_SOUND_IDS } from "@/lib/sfx/types";
import type { CaptionSegment, CaptionWord, SfxSettings, SfxSoundId } from "@/types/domain";

// The cue planner: decides where the viral sound effects land. It walks the
// word-synced captions, groups words into completed thoughts (sentences), and
// scores each one with the same transcript signals the clip finder uses. A
// sound is placed right after every line whose score clears the sensitivity
// threshold, spaced out so the effects punctuate the video instead of
// carpeting it. Pure and deterministic so it can run on the server export and
// be unit tested directly.

export type SfxCue = {
  /** Seconds (in the captions' own timebase) where the sound starts. */
  time: number;
  soundId: SfxSoundId;
};

const SENTENCE_END = /[.!?]["')\]]*$/;
/** A pause this long between words ends the thought even without punctuation. */
const PAUSE_BREAK_SEC = 1.4;
/** Sentences shorter than this can't be scored meaningfully. */
const MIN_SENTENCE_WORDS = 4;
/** Nudge after the last word so the hit lands just after the line, not on it. */
const CUE_OFFSET_SEC = 0.08;
/** Hard ceiling on placed sounds so hour-long edits don't explode the mix. */
const MAX_CUES = 80;

// Which sound fits the line. Sus-adjacent wording gets the Among Us reveal,
// shock wording gets the FA blast, everything else gets the default boom.
const AMONG_US_WORDS = /\b(sus|suspicious|impostor|imposter|sneaky|sneak|shady|liar|lying|caught|hiding)\b/i;
const FA_WORDS = /\b(insane|crazy|unbelievable|no way|shocking|ridiculous|blew|blown|unreal|wild)\b/i;

const SENSITIVITY: Record<SfxSettings["sensitivity"], { threshold: number; minGapSec: number }> = {
  subtle: { threshold: 72, minGapSec: 20 },
  balanced: { threshold: 62, minGapSec: 12 },
  aggressive: { threshold: 52, minGapSec: 6 }
};

type Sentence = { text: string; start: number; end: number; wordCount: number };

/**
 * Flattens the enabled captions into sentence units. Word-level timing is
 * used where the source provides it; a segment with no word timing becomes a
 * single unit spanning the whole segment so it still participates.
 */
function sentencesFrom(captions: CaptionSegment[]): Sentence[] {
  const words: CaptionWord[] = [];
  for (const segment of captions) {
    if (segment.enabled === false) continue;
    if (segment.words.length > 0) {
      for (const word of segment.words) {
        if (word.text.trim()) words.push(word);
      }
    } else if (segment.text.trim()) {
      words.push({ text: segment.text.trim(), start: segment.start, end: segment.end });
    }
  }
  words.sort((a, b) => a.start - b.start);

  const sentences: Sentence[] = [];
  let bucket: CaptionWord[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    sentences.push({
      text: bucket.map((word) => word.text.trim()).join(" "),
      start: bucket[0].start,
      end: bucket[bucket.length - 1].end,
      wordCount: bucket.length
    });
    bucket = [];
  };
  for (const word of words) {
    if (bucket.length > 0 && word.start - bucket[bucket.length - 1].end > PAUSE_BREAK_SEC) flush();
    bucket.push(word);
    if (SENTENCE_END.test(word.text.trim())) flush();
  }
  flush();
  return sentences;
}

/** Picks which sound fits the line, respecting the per-sound switches. */
function pickSound(text: string, sounds: SfxSettings["sounds"]): SfxSoundId | null {
  const preferred: SfxSoundId = AMONG_US_WORDS.test(text) ? "amongUs" : FA_WORDS.test(text) ? "fa" : "vineBoom";
  if (sounds[preferred]) return preferred;
  const fallback = SFX_SOUND_IDS.find((id) => sounds[id]);
  return fallback ?? null;
}

/**
 * Plans where the sound effects land for one video. `captions` are in
 * whatever timebase the caller renders in (source seconds for long-form,
 * trimmed clip seconds for shorts) and the returned cue times match it.
 */
export function planSfxCues(captions: CaptionSegment[], settings: SfxSettings): SfxCue[] {
  if (!settings.enabled) return [];
  if (!SFX_SOUND_IDS.some((id) => settings.sounds[id])) return [];
  const { threshold, minGapSec } = SENSITIVITY[settings.sensitivity] ?? SENSITIVITY.balanced;

  const candidates: Array<SfxCue & { importance: number }> = [];
  for (const sentence of sentencesFrom(captions)) {
    if (sentence.wordCount < MIN_SENTENCE_WORDS) continue;
    const signals = analyzeTranscript(captions, sentence.start - 0.01, sentence.end + 0.01);
    if (!signals.hasText) continue;
    // Intensity carries most of the weight — "important" here means emphatic
    // delivery — with the hook score adding curiosity/stakes wording, plus a
    // bump for lines that end on an exclamation or question.
    const endBonus = /!["')\]]*$/.test(sentence.text) ? 12 : /\?["')\]]*$/.test(sentence.text) ? 6 : 0;
    const importance = 0.55 * signals.intensity + 0.45 * signals.hook + endBonus;
    if (importance < threshold) continue;
    const soundId = pickSound(sentence.text, settings.sounds);
    if (!soundId) continue;
    candidates.push({ time: sentence.end + CUE_OFFSET_SEC, soundId, importance });
  }

  // Greedy spacing pass: keep every qualifying line that sits far enough
  // after the previous kept one.
  candidates.sort((a, b) => a.time - b.time);
  const kept: Array<SfxCue & { importance: number }> = [];
  for (const candidate of candidates) {
    const last = kept[kept.length - 1];
    if (last && candidate.time - last.time < minGapSec) continue;
    kept.push(candidate);
  }

  const capped = kept.length > MAX_CUES
    ? [...kept].sort((a, b) => b.importance - a.importance).slice(0, MAX_CUES).sort((a, b) => a.time - b.time)
    : kept;
  return capped.map(({ time, soundId }) => ({ time, soundId }));
}
