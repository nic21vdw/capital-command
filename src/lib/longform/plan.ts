import type { SilenceRange } from "@/lib/clipping/analysis";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { resolveThoughtEnd } from "@/lib/clipping/thought-end";
import type { CaptionSegment, CaptionStyle, CaptionWord } from "@/types/domain";
import type { LongformCaptions, LongformHook, LongformPace, LongformSegment } from "@/lib/longform/types";

// Pure planning logic for the Long-Form Editor: turn detected silences into a
// cut plan and the opening seconds into a viral-style hook. Everything here is
// deterministic and side-effect free so it can run on the server pipeline and
// be unit tested directly.

export type PacePresetId = "relaxed" | "fast" | "ultra";

export const PACE_PRESETS: Array<{ id: PacePresetId; label: string; description: string; pace: LongformPace }> = [
  {
    id: "relaxed",
    label: "Relaxed",
    description: "Only long pauses are cut — keeps a natural rhythm.",
    pace: { minSilenceSec: 1.2, paddingSec: 0.25 }
  },
  {
    id: "fast",
    label: "Fast",
    description: "Every noticeable pause goes. The retention sweet spot.",
    pace: { minSilenceSec: 0.7, paddingSec: 0.15 }
  },
  {
    id: "ultra",
    label: "Ultra",
    description: "Jump-cut everything — maximum pace, zero dead air.",
    pace: { minSilenceSec: 0.45, paddingSec: 0.08 }
  }
];

export const DEFAULT_PACE: LongformPace = PACE_PRESETS[1].pace;

/** Cuts shorter than this after padding aren't worth a jump cut. */
const MIN_CUT_SEC = 0.2;
/** Segments shorter than this are dropped as timeline noise. */
const MIN_SEGMENT_SEC = 0.05;

const HOOK_MIN_SEC = 4;
const HOOK_MAX_SEC = 10;
const HOOK_TARGET_SEC = 7;

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Tiles the source timeline into alternating speech/silence segments from the
 * detected silences. Silences shorter than `pace.minSilenceSec` are kept as
 * part of the surrounding speech; qualifying silences are shrunk by
 * `pace.paddingSec` on each side (breathing room around the cut) and marked
 * disabled so they drop out of the edited video.
 */
export function buildSegments(durationSec: number, silences: SilenceRange[], pace: LongformPace): LongformSegment[] {
  const duration = Math.max(0, durationSec);
  const segments: LongformSegment[] = [];
  let cursor = 0;
  let index = 0;
  const push = (start: number, end: number, kind: LongformSegment["kind"]) => {
    if (end - start < MIN_SEGMENT_SEC) return;
    index += 1;
    segments.push({
      id: `seg-${index}`,
      start: round3(start),
      end: round3(end),
      kind,
      enabled: kind === "speech"
    });
  };

  const sorted = [...silences].sort((a, b) => a.start - b.start);
  for (const silence of sorted) {
    const start = Math.max(0, silence.start);
    const end = Math.min(duration, silence.end);
    if (end - start < pace.minSilenceSec) continue;
    const cutStart = Math.max(cursor, start + pace.paddingSec);
    const cutEnd = Math.min(duration, end - pace.paddingSec);
    if (cutEnd - cutStart < MIN_CUT_SEC) continue;
    push(cursor, cutStart, "speech");
    push(cutStart, cutEnd, "silence");
    cursor = cutEnd;
  }
  push(cursor, duration, "speech");

  if (segments.length === 0 && duration > 0) {
    segments.push({ id: "seg-1", start: 0, end: round3(duration), kind: "speech", enabled: true });
  }
  return segments;
}

/**
 * Picks where the hook should end: as close to ~7 seconds as possible while
 * landing on a completed thought (never mid-sentence), clamped to 4-10s.
 */
export function planHookEnd(transcript: CaptionSegment[], durationSec: number): number {
  const maxEnd = Math.min(HOOK_MAX_SEC, Math.max(1, durationSec));
  const minEnd = Math.min(HOOK_MIN_SEC, maxEnd);
  const target = Math.min(HOOK_TARGET_SEC, maxEnd);
  if (transcript.length === 0) return round3(target);
  const resolved = resolveThoughtEnd(transcript, target, {
    minEnd,
    maxEnd,
    maxExtension: maxEnd - target,
    maxTrim: target - minEnd
  });
  return round3(resolved.end);
}

/**
 * Re-chunks the transcript inside the hook window into short punchy caption
 * segments (3 words at a time) — the burned-in style viral hooks use.
 */
export function hookCaptions(transcript: CaptionSegment[], hookEnd: number, maxWords = 3): CaptionSegment[] {
  const windowed = windowSegments(transcript, 0, hookEnd);
  const words = windowed.flatMap((segment) => segment.words);
  return words.length > 0 ? chunkWords(words, maxWords) : windowed;
}

/**
 * The default hook caption look: huge bold uppercase words in the middle of
 * the frame with the spoken word highlighted — the retention-editing style
 * that reads clearly even on a muted feed.
 */
export const VIRAL_HOOK_CAPTION_STYLE: CaptionStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontScale: 0.075,
  fontWeight: 900,
  textColor: "#ffffff",
  highlightColor: "#fde047",
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  outlineWidth: 4,
  shadow: 2,
  position: "middle",
  alignment: "center",
  maxWordsPerCaption: 3,
  wordsPerLine: 3,
  animation: "pop",
  uppercase: true
};

/** Builds the default hook plan for a freshly analyzed project. */
export function planHook(transcript: CaptionSegment[], durationSec: number): LongformHook {
  const end = planHookEnd(transcript, durationSec);
  return {
    enabled: true,
    end,
    zoom: 1.3,
    focusX: 0.5,
    focusY: 0.35,
    captionsEnabled: true,
    highlightCurrentWord: true,
    captions: hookCaptions(transcript, end),
    captionStyle: { ...VIRAL_HOOK_CAPTION_STYLE }
  };
}

/**
 * The default whole-video caption look: readable bottom-of-frame phrases for a
 * 16:9 long-form upload — smaller and calmer than the viral hook style, closer
 * to classic subtitles but still word-highlighted.
 */
export const LONGFORM_CAPTION_STYLE: CaptionStyle = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontScale: 0.045,
  // One of the Weight control's options (400/600/800/900) so the select
  // always reflects the actual value.
  fontWeight: 800,
  textColor: "#ffffff",
  highlightColor: "#fde047",
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  outlineWidth: 2.5,
  shadow: 2,
  position: "bottom",
  alignment: "center",
  maxWordsPerCaption: 5,
  wordsPerLine: 5,
  animation: "fade",
  uppercase: false
};

/**
 * Re-chunks the full transcript into readable caption segments — the same
 * word-stream chunking the short-form clips use, over the whole source.
 */
export function transcriptCaptions(transcript: CaptionSegment[], maxWords = 5): CaptionSegment[] {
  const words = transcript.flatMap((segment) => segment.words);
  if (words.length > 0) return chunkWords(words, maxWords);
  // Transcripts without word timing keep their phrase segments as-is.
  return transcript.map((segment, index) => ({ ...segment, id: `cap-${index + 1}`, words: [] }));
}

/**
 * Builds the default whole-video caption plan. Captions start switched off —
 * they are a toggle-on feature, so existing exports keep rendering unchanged
 * until the editor enables them.
 */
export function planCaptions(transcript: CaptionSegment[]): LongformCaptions {
  return {
    enabled: false,
    highlightCurrentWord: true,
    segments: transcriptCaptions(transcript),
    style: { ...LONGFORM_CAPTION_STYLE }
  };
}

/**
 * Non-destructively applies a manual keep/cut across an arbitrary [start, end]
 * span, splitting any segments that straddle the boundaries so exactly that
 * span flips to `enabled`. This powers manual trimming: the editor can remove
 * (or restore) any sub-range of the video, not just whole detected segments.
 * Segment kinds are preserved and ids are re-sequenced so they stay unique.
 */
export function applyManualRange(
  segments: LongformSegment[],
  rangeStart: number,
  rangeEnd: number,
  enabled: boolean
): LongformSegment[] {
  const lo = Math.min(rangeStart, rangeEnd);
  const hi = Math.max(rangeStart, rangeEnd);
  if (hi - lo < MIN_SEGMENT_SEC) return segments;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out: LongformSegment[] = [];
  const add = (seg: LongformSegment, start: number, end: number, en: boolean) => {
    if (end - start < MIN_SEGMENT_SEC) return;
    out.push({ ...seg, start: round3(start), end: round3(end), enabled: en });
  };
  for (const seg of sorted) {
    if (seg.end <= lo || seg.start >= hi) {
      out.push(seg);
      continue;
    }
    // Left slice keeps its state, the overlapping middle flips, the right keeps.
    add(seg, seg.start, Math.min(seg.end, lo), seg.enabled);
    add(seg, Math.max(seg.start, lo), Math.min(seg.end, hi), enabled);
    add(seg, Math.max(seg.start, hi), seg.end, seg.enabled);
  }
  return out.map((seg, index) => ({ ...seg, id: `seg-${index + 1}` }));
}

export type KeptRange = { start: number; end: number };

/**
 * Merges the enabled segments into contiguous play ranges. Adjacent enabled
 * segments (e.g. speech on both sides of a re-enabled silence) fuse into one
 * range so the export never jump-cuts inside continuous footage.
 */
export function keptRanges(segments: LongformSegment[]): KeptRange[] {
  const ranges: KeptRange[] = [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  for (const segment of sorted) {
    if (!segment.enabled || segment.end - segment.start < MIN_SEGMENT_SEC) continue;
    const last = ranges[ranges.length - 1];
    if (last && segment.start - last.end < 0.002) last.end = Math.max(last.end, segment.end);
    else ranges.push({ start: segment.start, end: segment.end });
  }
  return ranges;
}

/**
 * Splits the play ranges into the hook part (played verbatim, rendered with
 * the punch-in + captions) and the body ranges after it. The hook always
 * plays [0, hook.end] uncut — its pauses are part of the delivery.
 */
export function exportRanges(
  segments: LongformSegment[],
  hook: LongformHook
): { hookRange: KeptRange | null; bodyRanges: KeptRange[] } {
  const kept = keptRanges(segments);
  if (!hook.enabled || hook.end <= 0) return { hookRange: null, bodyRanges: kept };
  const hookRange = { start: 0, end: hook.end };
  const bodyRanges = kept
    .filter((range) => range.end > hook.end + MIN_SEGMENT_SEC)
    .map((range) => ({ start: Math.max(range.start, hook.end), end: range.end }));
  return { hookRange, bodyRanges };
}

/**
 * Maps a span of the source timeline onto the edited runtime. Because the
 * export plays the hook verbatim then concatenates the kept body ranges, a
 * single source span can land on several disjoint output intervals (or none,
 * if it sits entirely inside cut footage). Used to time timeline overlays in
 * the exported video exactly as they appear scrubbing the source.
 */
export function sourceToOutputIntervals(
  sourceStart: number,
  sourceEnd: number,
  segments: LongformSegment[],
  hook: LongformHook
): KeptRange[] {
  const { hookRange, bodyRanges } = exportRanges(segments, hook);
  const pieces: Array<{ srcStart: number; srcEnd: number; outStart: number }> = [];
  let outCursor = 0;
  if (hookRange) {
    pieces.push({ srcStart: hookRange.start, srcEnd: hookRange.end, outStart: outCursor });
    outCursor += hookRange.end - hookRange.start;
  }
  for (const range of bodyRanges) {
    pieces.push({ srcStart: range.start, srcEnd: range.end, outStart: outCursor });
    outCursor += range.end - range.start;
  }

  const intervals: KeptRange[] = [];
  for (const piece of pieces) {
    const s = Math.max(sourceStart, piece.srcStart);
    const e = Math.min(sourceEnd, piece.srcEnd);
    if (e - s <= 0.001) continue;
    const start = round3(piece.outStart + (s - piece.srcStart));
    const end = round3(piece.outStart + (e - piece.srcStart));
    const last = intervals[intervals.length - 1];
    if (last && start - last.end < 0.01) last.end = Math.max(last.end, end);
    else intervals.push({ start, end });
  }
  return intervals;
}

/**
 * Maps a single source-timeline instant onto the edited runtime. If the point
 * lands inside kept footage it returns the exact output time; if it falls in a
 * cut stretch it snaps forward to where the next kept footage begins. Returns
 * `null` only when the whole edit is empty. Used to time placed audio clips.
 */
export function sourceTimeToOutput(
  sourceT: number,
  segments: LongformSegment[],
  hook: LongformHook
): number | null {
  const { hookRange, bodyRanges } = exportRanges(segments, hook);
  const pieces: KeptRange[] = [];
  if (hookRange) pieces.push(hookRange);
  for (const range of bodyRanges) pieces.push(range);
  if (pieces.length === 0) return null;

  let outCursor = 0;
  for (const piece of pieces) {
    const span = piece.end - piece.start;
    if (sourceT < piece.start) return round3(outCursor); // inside a cut → next piece
    if (sourceT <= piece.end) return round3(outCursor + (sourceT - piece.start));
    outCursor += span;
  }
  return round3(outCursor); // past the end → clamp to the edit's end
}

/**
 * Maps source-time caption segments onto the edited runtime for burn-in.
 * Segments authored in source seconds shift back by every cut before them; a
 * segment straddling a cut is shortened (its words inside the cut snap to the
 * jump point) and one that sits entirely inside cut footage is dropped.
 * `skipBeforeSec` clips captions to after that source time — used to hand the
 * hook window over to the hook's own burned-in captions.
 */
export function remapCaptionsToOutput(
  captions: CaptionSegment[],
  segments: LongformSegment[],
  hook: LongformHook,
  skipBeforeSec = 0
): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const seg of captions) {
    if (!seg.enabled || !seg.text.trim()) continue;
    const srcStart = Math.max(seg.start, skipBeforeSec);
    if (seg.end - srcStart < 0.05) continue;
    const intervals = sourceToOutputIntervals(srcStart, seg.end, segments, hook);
    if (intervals.length === 0) continue;
    const start = intervals[0].start;
    const end = intervals[intervals.length - 1].end;
    if (end - start < 0.05) continue;
    const words: CaptionWord[] = [];
    for (const word of seg.words) {
      if (word.end <= srcStart) continue;
      const wordStart = sourceTimeToOutput(Math.max(word.start, srcStart), segments, hook);
      const wordEnd = sourceTimeToOutput(word.end, segments, hook);
      if (wordStart === null || wordEnd === null) continue;
      const clampedStart = Math.min(Math.max(wordStart, start), end);
      words.push({ text: word.text, start: clampedStart, end: Math.min(Math.max(wordEnd, clampedStart), end) });
    }
    out.push({ ...seg, id: `cap-${out.length + 1}`, start, end, words });
  }
  return out;
}

/** Total runtime of the edited video (hook + kept body). */
export function editedDurationSec(segments: LongformSegment[], hook: LongformHook): number {
  const { hookRange, bodyRanges } = exportRanges(segments, hook);
  const hookSec = hookRange ? hookRange.end - hookRange.start : 0;
  return round3(hookSec + bodyRanges.reduce((sum, range) => sum + (range.end - range.start), 0));
}
