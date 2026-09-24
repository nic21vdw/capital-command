import { norm, PURE_FILLERS } from "@/lib/story/cleanup";
import { contentTokens } from "@/lib/story/units";
import type { AudioScores, UnitScores, VisualSample, VisualScores, Word } from "@/lib/story/types";

export const TALKING_HEAD_FACE_HEIGHT = 0.2;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

export type VisualBaseline = {
  sharpP10: number;
  sharpP90: number;
  motionP50: number;
  motionP99: number;
  gestureP90: number;
  faceShare: number;
};

export function visualBaseline(samples: VisualSample[]): VisualBaseline {
  const sharp = samples.map((sample) => sample.face?.sharp ?? sample.sharp);
  const motion = samples.map((sample) => sample.motion);
  const gesture = samples.filter((sample) => sample.face).map((sample) => sample.face!.gesture);
  return {
    sharpP10: percentile(sharp, 0.1),
    sharpP90: percentile(sharp, 0.9),
    motionP50: percentile(motion, 0.5),
    motionP99: percentile(motion, 0.99),
    gestureP90: Math.max(0.01, percentile(gesture, 0.9)),
    faceShare: samples.length ? samples.filter((sample) => sample.face).length / samples.length : 0
  };
}

export function samplesIn(samples: VisualSample[], start: number, end: number): VisualSample[] {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (samples[mid].t < start) low = mid + 1;
    else high = mid;
  }
  const out: VisualSample[] = [];
  for (let i = low; i < samples.length && samples[i].t <= end; i++) out.push(samples[i]);
  return out;
}

export function scoreVisual(samples: VisualSample[], baseline: VisualBaseline): VisualScores {
  if (samples.length === 0) {
    return { sharpness: 0.5, exposure: 0.5, framing: 0.5, eyeContact: 0.5, motion: 0.5, gesture: 0.5, variety: 0, unusable: [] };
  }
  const withFace = samples.filter((sample) => sample.face);
  const faceShare = withFace.length / samples.length;
  const sharpValues = samples.map((sample) => sample.face?.sharp ?? sample.sharp);
  const meanSharp = sharpValues.reduce((sum, value) => sum + value, 0) / sharpValues.length;
  const range = Math.max(1, baseline.sharpP90 - baseline.sharpP10);
  const sharpness = clamp01((meanSharp - baseline.sharpP10) / range);
  const meanLuma = samples.reduce((sum, sample) => sum + (sample.face?.luma ?? sample.luma), 0) / samples.length;
  const exposure = clamp01(1 - Math.abs(meanLuma - 128) / 110);
  const front = withFace.length ? withFace.reduce((sum, sample) => sum + sample.face!.front, 0) / withFace.length : 0;
  const eyeContact = clamp01(front * faceShare);
  const framing = baseline.faceShare > 0.3 ? clamp01(faceShare / Math.max(0.01, baseline.faceShare)) : 0.6;
  const meanMotion = samples.reduce((sum, sample) => sum + sample.motion, 0) / samples.length;
  const motionRatio = meanMotion / Math.max(0.5, baseline.motionP50);
  const motion = clamp01(motionRatio < 1 ? 0.5 + motionRatio / 2 : 1.5 - motionRatio / 4);
  const gesture = withFace.length
    ? clamp01(withFace.reduce((sum, sample) => sum + sample.face!.gesture, 0) / withFace.length / baseline.gestureP90)
    : 0;
  const cuts = samples.filter((sample) => sample.cut).length;
  const variety = clamp01(cuts / 3 + Math.min(0.5, motionRatio / 6));

  const unusable: string[] = [];
  if (baseline.faceShare > 0.5 && faceShare < 0.35) unusable.push("out of frame");
  if (withFace.length > 0 && front < 0.3) unusable.push("looking away");
  if (sharpness < 0.05 && meanSharp < baseline.sharpP10) unusable.push("blur");
  if (samples.some((sample) => !sample.cut && sample.motion > baseline.motionP99 * 1.5)) unusable.push("camera bump");

  return {
    sharpness: round(sharpness),
    exposure: round(exposure),
    framing: round(framing),
    eyeContact: round(eyeContact),
    motion: round(motion),
    gesture: round(gesture),
    variety: round(variety),
    unusable
  };
}

export function visualScore(visual: VisualScores): number {
  const base =
    visual.sharpness * 0.2 +
    visual.exposure * 0.15 +
    visual.framing * 0.15 +
    visual.eyeContact * 0.2 +
    visual.motion * 0.1 +
    visual.gesture * 0.1 +
    visual.variety * 0.1;
  return round(clamp01(base - visual.unusable.length * 0.15));
}

export function scoreAudio(
  words: Word[],
  firstWord: number,
  lastWord: number,
  envelope: Float32Array | null,
  hopSec: number,
  medianDb: number
): AudioScores {
  const slice = words.slice(firstWord, lastWord + 1);
  const fillers = slice.filter((word) => PURE_FILLERS.has(norm(word.w))).length;
  const spoken = slice.reduce((sum, word) => sum + Math.max(0, word.e - word.s), 0);
  const span = Math.max(0.5, slice[slice.length - 1].e - slice[0].s);
  const clarity = slice.reduce((sum, word) => sum + (word.p ?? 0.8), 0) / slice.length;
  let energy = 0.5;
  if (envelope && envelope.length) {
    let total = 0;
    let count = 0;
    for (const word of slice) {
      for (let k = Math.floor(word.s / hopSec); k < Math.min(envelope.length, Math.ceil(word.e / hopSec)); k++) {
        total += envelope[k];
        count++;
      }
    }
    if (count) energy = clamp01(0.5 + (total / count - medianDb) / 16);
  }
  return {
    clarity: round(clarity),
    energy: round(energy),
    paceWpm: Math.round((slice.length / Math.max(spoken, span * 0.6)) * 60),
    fillerRate: round(fillers / slice.length)
  };
}

export function paceScore(wpm: number): number {
  if (wpm < 90) return clamp01(wpm / 90) * 0.6;
  if (wpm <= 200) return 1;
  return clamp01(1 - (wpm - 200) / 120);
}

export function deliveryScore(audio: AudioScores): number {
  return round(clamp01(audio.energy * 0.45 + paceScore(audio.paceWpm) * 0.35 + (1 - Math.min(1, audio.fillerRate * 5)) * 0.2));
}

const STORY_MARKERS =
  /\$\d|\d+%|\d{2,}|revenue|money|dollars|sold|licen[cs]e|customers?|users?|launch|shipped|built|broke|broken|fixed|bug|problem|because|finally|secret|mistake|learned|never|always|biggest|first|why|how|actually|turns out|realized|insane|crazy|holy|wow/i;

const EMOTION_MARKERS = /!|insane|crazy|holy|wow|love|hate|scared|excited|finally|dude|oh my|let's go|no way|what the/i;

export function heuristicStory(text: string, tokenRarity: (token: string) => number): { story: number; emotion: number; novelty: number } {
  const markers = (text.match(new RegExp(STORY_MARKERS.source, "gi")) ?? []).length;
  const tokens = contentTokens(text);
  const story = clamp01(0.25 + markers * 0.12 + Math.min(0.3, tokens.length / 60));
  const emotion = clamp01(0.2 + (text.match(new RegExp(EMOTION_MARKERS.source, "gi")) ?? []).length * 0.2);
  const novelty = tokens.length ? clamp01(tokens.reduce((sum, token) => sum + tokenRarity(token), 0) / tokens.length) : 0;
  return { story: round(story), emotion: round(emotion), novelty: round(novelty) };
}

export const SCORE_WEIGHTS = { story: 0.3, clarity: 0.1, emotion: 0.1, visual: 0.2, delivery: 0.2, novelty: 0.1 };

export function combineScores(parts: Omit<UnitScores, "combined" | "audio">): UnitScores {
  const audio = round((parts.clarity + parts.delivery) / 2);
  const combined =
    parts.story * SCORE_WEIGHTS.story +
    parts.clarity * SCORE_WEIGHTS.clarity +
    parts.emotion * SCORE_WEIGHTS.emotion +
    parts.visual * SCORE_WEIGHTS.visual +
    parts.delivery * SCORE_WEIGHTS.delivery +
    parts.novelty * SCORE_WEIGHTS.novelty;
  return { ...parts, audio, combined: round(combined) };
}

export function describeUnit(scores: UnitScores, audio: AudioScores, visual: VisualScores): string {
  const notes: string[] = [];
  if (scores.story >= 0.6) notes.push("carries the story");
  else if (scores.story < 0.35) notes.push("little story value");
  if (audio.energy >= 0.65) notes.push("high vocal energy");
  else if (audio.energy < 0.35) notes.push("low energy delivery");
  if (paceScore(audio.paceWpm) < 0.6) notes.push(`pace ${audio.paceWpm} wpm`);
  if (audio.fillerRate > 0.08) notes.push("filler-heavy");
  if (visual.eyeContact >= 0.6) notes.push("looking at camera");
  if (visual.gesture >= 0.6) notes.push("animated on camera");
  if (visual.sharpness < 0.2) notes.push("soft picture");
  for (const flag of visual.unusable) notes.push(flag);
  return notes.length ? notes.join(", ") : "steady delivery";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
