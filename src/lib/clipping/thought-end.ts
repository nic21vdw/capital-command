import type { CaptionSegment } from "@/types/domain";

/**
 * Clip-ending quality control. A clip must never cut off while the speaker is
 * halfway through a sentence: the end has to land where a thought actually
 * concludes. This module finds those conclusion points in the transcript and
 * resolves a proposed clip end onto one — preferring to run a few seconds
 * longer to let the thought finish, and only trimming back to the previous
 * completed sentence when extending is not possible.
 */

/** Text that ends a sentence (optionally inside closing quotes/brackets). */
const SENTENCE_END = /[.!?…]["'”’)\]]*\s*$/;

/**
 * A gap between one caption segment ending and the next starting that is long
 * enough to read as a real pause in speech. This is what marks thought ends in
 * transcripts that carry no punctuation (e.g. platform auto-captions).
 */
const PAUSE_GAP_SEC = 0.7;

export type ThoughtEndOptions = {
  /** Earliest acceptable end — keeps the clip at least its minimum length. */
  minEnd: number;
  /** Absolute latest the end may reach (hard length cap / end of stream). */
  maxEnd: number;
  /** How far past the proposed end the clip may run to finish the thought. */
  maxExtension: number;
  /** How far back the end may be pulled to the previous completed thought. */
  maxTrim: number;
};

export type ThoughtEndResult = {
  end: number;
  /** True when the end lands on a detected thought conclusion. */
  concluded: boolean;
};

/**
 * Times (in seconds) at which a spoken thought plausibly concludes: a segment
 * whose text finishes a sentence, a segment followed by a real pause, or the
 * final segment of the transcript.
 */
export function thoughtEndTimes(segments: CaptionSegment[]): number[] {
  const spoken = segments
    .filter((seg) => seg.text.trim().length > 0)
    .sort((a, b) => a.start - b.start);
  const times: number[] = [];
  for (let i = 0; i < spoken.length; i++) {
    const seg = spoken[i];
    const next = spoken[i + 1];
    const endsSentence = SENTENCE_END.test(seg.text.trim());
    const pauseFollows = next ? next.start - seg.end >= PAUSE_GAP_SEC : true;
    if (endsSentence || pauseFollows) times.push(seg.end);
  }
  return times;
}

/**
 * Resolves a proposed clip end onto the best nearby thought conclusion.
 *
 * Preference order:
 *  1. The first thought end at/after the proposal within `maxExtension` — a
 *     slightly longer clip that finishes the sentence beats a shorter one that
 *     cuts it off.
 *  2. The last thought end before the proposal within `maxTrim` (and not below
 *     `minEnd`) — dropping a trailing fragment of the next sentence.
 *  3. The proposal itself, clamped, when the transcript offers nothing usable.
 */
export function resolveThoughtEnd(
  segments: CaptionSegment[],
  proposedEnd: number,
  options: ThoughtEndOptions
): ThoughtEndResult {
  const { minEnd, maxEnd, maxExtension, maxTrim } = options;
  const clampEnd = (value: number) => Math.min(maxEnd, Math.max(minEnd, value));
  const target = clampEnd(proposedEnd);
  const times = thoughtEndTimes(segments);
  if (times.length === 0) return { end: target, concluded: false };

  // Treat a thought end a hair after the target as "at" it — caption timings
  // routinely trail the audio by a beat.
  let forward: number | null = null;
  for (const t of times) {
    if (t >= target - 0.25 && t <= maxEnd && t - target <= maxExtension) {
      forward = t;
      break;
    }
  }
  if (forward !== null && forward >= minEnd) return { end: forward, concluded: true };

  let backward: number | null = null;
  for (const t of times) {
    if (t > target) break;
    if (t >= minEnd && target - t <= maxTrim) backward = t;
  }
  if (backward !== null) return { end: backward, concluded: true };

  return { end: target, concluded: false };
}
