import type { SilenceRange } from "@/lib/clipping/analysis";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { resolveThoughtEnd } from "@/lib/clipping/thought-end";
import type { CaptionSegment, CaptionStyle, CaptionWord } from "@/types/domain";
import type {
  LongformCaptions,
  LongformHook,
  LongformPace,
  LongformProject,
  LongformSegment,
  LongformTopic
} from "@/lib/longform/types";

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
export function hookCaptions(
  transcript: CaptionSegment[],
  hookStart: number,
  hookEnd: number,
  maxWords = 3
): CaptionSegment[] {
  // windowSegments rebases the caption times to the window start, so the
  // returned captions are hook-local (0 = the hook's first frame) — exactly
  // what the export burns onto the extracted hook clip.
  const windowed = windowSegments(transcript, hookStart, hookEnd);
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
    start: 0,
    end,
    zoom: 1.3,
    focusX: 0.5,
    focusY: 0.35,
    captionsEnabled: true,
    highlightCurrentWord: true,
    captions: hookCaptions(transcript, 0, end),
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
 * the punch-in + captions) and the body ranges around it. The hook window
 * [hook.start, hook.end] always plays uncut and is placed at the front of the
 * export — its pauses are part of the delivery. The body is every other kept
 * range, so footage before the hook window plays after it (the common case is
 * to have disabled that footage anyway). With the default start of 0 this
 * reduces to "hook first, then everything after it".
 */
export function exportRanges(
  segments: LongformSegment[],
  hook: LongformHook
): { hookRange: KeptRange | null; bodyRanges: KeptRange[] } {
  const kept = keptRanges(segments);
  const hookStart = Math.max(0, hook.start ?? 0);
  if (!hook.enabled || hook.end <= hookStart) return { hookRange: null, bodyRanges: kept };
  const hookRange = { start: hookStart, end: hook.end };
  const bodyRanges: KeptRange[] = [];
  for (const range of kept) {
    // The slice of this kept range before the hook window.
    const beforeEnd = Math.min(range.end, hookStart);
    if (beforeEnd - range.start > MIN_SEGMENT_SEC) bodyRanges.push({ start: range.start, end: beforeEnd });
    // The slice after the hook window.
    const afterStart = Math.max(range.start, hook.end);
    if (range.end - afterStart > MIN_SEGMENT_SEC) bodyRanges.push({ start: afterStart, end: range.end });
  }
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
 *
 * The output pieces are the hook window (pulled to the front) followed by the
 * body ranges, so they are NOT necessarily in source order once the hook is
 * moved off the opening — every lookup is resolved by source containment, not
 * by walking pieces in order.
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

  // Give every piece its output start (cumulative in output/concat order).
  let outCursor = 0;
  const placed = pieces.map((piece) => {
    const outStart = outCursor;
    outCursor += piece.end - piece.start;
    return { ...piece, outStart };
  });

  // Inside a kept piece → exact output time.
  for (const piece of placed) {
    if (sourceT >= piece.start && sourceT <= piece.end) return round3(piece.outStart + (sourceT - piece.start));
  }
  // In a cut (or before the first kept footage) → snap forward to the next kept
  // footage in source order, wherever that lands in the output.
  const next = placed.filter((piece) => piece.start > sourceT).sort((a, b) => a.start - b.start)[0];
  if (next) return round3(next.outStart);
  return round3(outCursor); // past the end → clamp to the edit's end
}

/**
 * Maps source-time caption segments onto the edited runtime for burn-in.
 * Segments authored in source seconds shift back by every cut before them; a
 * segment straddling a cut is shortened (its words inside the cut snap to the
 * jump point) and one that sits entirely inside cut footage is dropped.
 * `skipWindow` clips captions out of that source window — used to hand the hook
 * window over to the hook's own burned-in captions. A caption straddling a
 * window edge keeps its larger outside piece; one entirely inside is dropped.
 */
export function remapCaptionsToOutput(
  captions: CaptionSegment[],
  segments: LongformSegment[],
  hook: LongformHook,
  skipWindow: KeptRange | null = null
): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const seg of captions) {
    if (!seg.enabled || !seg.text.trim()) continue;
    let srcStart = seg.start;
    let srcEnd = seg.end;
    if (skipWindow && srcStart < skipWindow.end && srcEnd > skipWindow.start) {
      const beforeLen = Math.max(0, skipWindow.start - srcStart);
      const afterLen = Math.max(0, srcEnd - skipWindow.end);
      if (beforeLen <= 0 && afterLen <= 0) continue; // fully inside the window → hook owns it
      if (afterLen >= beforeLen) srcStart = Math.max(srcStart, skipWindow.end);
      else srcEnd = Math.min(srcEnd, skipWindow.start);
    }
    if (srcEnd - srcStart < 0.05) continue;
    const intervals = sourceToOutputIntervals(srcStart, srcEnd, segments, hook);
    if (intervals.length === 0) continue;
    const start = intervals[0].start;
    const end = intervals[intervals.length - 1].end;
    if (end - start < 0.05) continue;
    const words: CaptionWord[] = [];
    for (const word of seg.words) {
      if (word.end <= srcStart || word.start >= srcEnd) continue;
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

// ----- Topic segments -----
// A topic segment is exported as its own video by running the WHOLE export
// engine over a restricted view of the project: the same cuts, captions,
// overlays and mix, with the timeline clipped to the segment's ranges and the
// hook moved onto its opening. Nothing downstream needs to know a segment is
// being rendered rather than the full edit — a segment gathered from four
// places in the stream is just a cut plan with three more gaps in it, which is
// what dead-space cutting already produces.

/** The hook a topic segment opens with: the project's hook style, its own window. */
function topicHook(project: LongformProject, ranges: KeptRange[], runtime: number): LongformHook {
  const source = project.hook;
  const opening = ranges[0];
  const start = opening.start;
  if (!source?.enabled) return { ...source, enabled: false, start: round3(start), end: round3(start) };
  const sourceLength = Math.max(MIN_SEGMENT_SEC, source.end - (source.start ?? 0));
  // Never let the hook eat more than half of a short segment, and never let it
  // run past the first range into footage this segment doesn't play.
  const length = Math.min(sourceLength, opening.end - start, runtime / 2);
  const hookEnd = round3(Math.min(opening.end, start + length));
  return {
    ...source,
    start: round3(start),
    end: hookEnd,
    captions: hookCaptions(project.transcript ?? [], start, hookEnd)
  };
}

/**
 * The stretches of the recording a segment plays, clamped to the source and in
 * chronological order with any overlaps merged. Topics planned before segments
 * could be gathered carry no `ranges` and read back as the single window
 * `[start, end]`.
 */
export function topicRanges(project: LongformProject, topic: LongformTopic): KeptRange[] {
  const raw = topic.ranges?.length ? topic.ranges : [{ start: topic.start, end: topic.end }];
  const limit = project.durationSec > 0 ? project.durationSec : Math.max(...raw.map((range) => range.end));
  const ranges: KeptRange[] = [];
  for (const range of [...raw].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, Math.min(range.start, limit));
    const end = Math.min(range.end, limit);
    if (end - start < MIN_SEGMENT_SEC) continue;
    const last = ranges[ranges.length - 1];
    if (last && start - last.end < 0.002) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  if (ranges.length === 0) {
    const start = Math.max(0, Math.min(raw[0].start, limit));
    return [{ start, end: start + MIN_SEGMENT_SEC }];
  }
  return ranges;
}

/**
 * A view of the project restricted to one topic segment. The cut plan is
 * clipped to the segment's ranges, the hook is re-pointed at its opening, and
 * placed audio is clipped the same way so music from another part of the
 * stream cannot slide into this one. Pure — the stored project is untouched.
 */
export function projectForTopic(project: LongformProject, topic: LongformTopic): LongformProject {
  const ranges = topicRanges(project, topic);
  const runtime = ranges.reduce((sum, range) => sum + (range.end - range.start), 0);

  const segments = ranges
    .flatMap((range) =>
      project.segments
        .filter((segment) => segment.end > range.start && segment.start < range.end)
        .map((segment) => ({
          ...segment,
          start: round3(Math.max(segment.start, range.start)),
          end: round3(Math.min(segment.end, range.end))
        }))
    )
    .filter((segment) => segment.end - segment.start >= MIN_SEGMENT_SEC)
    .sort((a, b) => a.start - b.start)
    .map((segment, index) => ({ ...segment, id: `seg-${index + 1}` }));

  // A placed track can be caught by more than one range, and each surviving
  // piece needs its own id so the mix doesn't collapse them into one clip.
  const clips = (project.music?.clips ?? []).flatMap((clip) => {
    const pieces = ranges
      .map((range) => {
        const clipStart = Math.max(clip.start, range.start);
        const clipEnd = Math.min(clip.start + clip.duration, range.end);
        return { ...clip, start: round3(clipStart), duration: round3(clipEnd - clipStart) };
      })
      .filter((piece) => piece.duration >= 0.1);
    return pieces.length > 1
      ? pieces.map((piece, index) => ({ ...piece, id: `${piece.id}-p${index + 1}` }))
      : pieces;
  });

  return {
    ...project,
    name: topic.title || project.name,
    segments,
    hook: topicHook(project, ranges, runtime),
    music: { ...project.music, clips }
  };
}

/** Runtime of one topic segment once the cuts inside it are applied. */
export function topicDurationSec(project: LongformProject, topic: LongformTopic): number {
  const view = projectForTopic(project, topic);
  return editedDurationSec(view.segments, view.hook);
}

/** Total runtime of the edited video (hook + kept body). */
export function editedDurationSec(segments: LongformSegment[], hook: LongformHook): number {
  const { hookRange, bodyRanges } = exportRanges(segments, hook);
  const hookSec = hookRange ? hookRange.end - hookRange.start : 0;
  return round3(hookSec + bodyRanges.reduce((sum, range) => sum + (range.end - range.start), 0));
}
