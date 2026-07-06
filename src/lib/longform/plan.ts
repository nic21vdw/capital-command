import type { SilenceRange } from "@/lib/clipping/analysis";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { resolveThoughtEnd } from "@/lib/clipping/thought-end";
import type { CaptionSegment, CaptionStyle } from "@/types/domain";
import type { LongformHook, LongformPace, LongformSegment } from "@/lib/longform/types";

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

/** Total runtime of the edited video (hook + kept body). */
export function editedDurationSec(segments: LongformSegment[], hook: LongformHook): number {
  const { hookRange, bodyRanges } = exportRanges(segments, hook);
  const hookSec = hookRange ? hookRange.end - hookRange.start : 0;
  return round3(hookSec + bodyRanges.reduce((sum, range) => sum + (range.end - range.start), 0));
}
