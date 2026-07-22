"use strict";

import type { CaptionSegment, CaptionWord, ClipEditSegment, Overlay } from "@/types/domain";

const MIN_SEGMENT_SEC = 0.05;
export const DEFAULT_CLIP_SILENCE_SEC = 0.45;
export const DEFAULT_CLIP_SILENCE_PADDING_SEC = 0.08;

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

type TimedSpeech = { start: number; end: number };

function speechWindows(captions: CaptionSegment[]): TimedSpeech[] {
  const words = captions
    .flatMap((caption) => caption.words)
    .filter((word) => word.end > word.start && word.text.trim())
    .map((word) => ({ start: word.start, end: word.end }))
    .sort((a, b) => a.start - b.start);
  const raw = words.length
    ? words
    : captions
        .filter((caption) => caption.enabled && caption.end > caption.start && caption.text.trim())
        .map((caption) => ({ start: caption.start, end: caption.end }))
        .sort((a, b) => a.start - b.start);

  const merged: TimedSpeech[] = [];
  for (const window of raw) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end + 0.08) last.end = Math.max(last.end, window.end);
    else merged.push({ ...window });
  }
  return merged;
}

/**
 * Builds the Clip Editor's non-destructive keep/cut plan from word timing.
 * Noticeable gaps become disabled silence segments with a little speech
 * padding left on both sides. Every segment remains in the project so one
 * click can restore it.
 */
export function buildClipSegmentsFromSilences(
  durationSec: number,
  silences: Array<{ start: number; end: number }>,
  options: { minSilenceSec?: number; paddingSec?: number } = {}
): ClipEditSegment[] {
  const duration = Math.max(0.1, durationSec);
  const minSilence = options.minSilenceSec ?? DEFAULT_CLIP_SILENCE_SEC;
  const padding = options.paddingSec ?? DEFAULT_CLIP_SILENCE_PADDING_SEC;
  const cuts = silences
    .map((silence) => ({
      start: Math.max(0, silence.start),
      end: Math.min(duration, silence.end)
    }))
    .filter((silence) => silence.end - silence.start >= minSilence)
    .map((silence) => ({
      start: silence.start <= 0 ? 0 : silence.start + padding,
      end: silence.end >= duration ? duration : silence.end - padding
    }))
    .filter((silence) => silence.end - silence.start >= MIN_SEGMENT_SEC)
    .sort((a, b) => a.start - b.start);

  const segments: ClipEditSegment[] = [];
  let cursor = 0;
  const add = (start: number, end: number, kind: ClipEditSegment["kind"], enabled: boolean) => {
    if (end - start < MIN_SEGMENT_SEC) return;
    segments.push({
      id: "clip-seg-" + (segments.length + 1),
      start: round3(start),
      end: round3(end),
      kind,
      enabled
    });
  };
  for (const cut of cuts) {
    const start = Math.max(cursor, cut.start);
    const end = Math.max(start, cut.end);
    add(cursor, start, "speech", true);
    add(start, end, "silence", false);
    cursor = end;
  }
  add(cursor, duration, "speech", true);
  return segments.length
    ? segments
    : [{ id: "clip-seg-1", start: 0, end: round3(duration), kind: "speech", enabled: true }];
}

/**
 * Builds the Clip Editor's non-destructive keep/cut plan from word timing.
 * Noticeable gaps become disabled silence segments with a little speech
 * padding left on both sides. Every segment remains in the project so one
 * click can restore it.
 */
export function buildClipSegments(
  durationSec: number,
  captions: CaptionSegment[],
  options: { minSilenceSec?: number; paddingSec?: number } = {}
): ClipEditSegment[] {
  const duration = Math.max(0.1, durationSec);
  const minSilence = options.minSilenceSec ?? DEFAULT_CLIP_SILENCE_SEC;
  const speech = speechWindows(captions);
  if (speech.length === 0) {
    return [{ id: "clip-seg-1", start: 0, end: round3(duration), kind: "speech", enabled: true }];
  }

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const window of speech) {
    const gap = { start: Math.max(0, cursor), end: Math.min(duration, window.start) };
    if (gap.end - gap.start >= minSilence) gaps.push(gap);
    cursor = Math.max(cursor, window.end);
  }
  if (duration - cursor >= minSilence) gaps.push({ start: cursor, end: duration });
  return buildClipSegmentsFromSilences(duration, gaps, options);
}

export function ensureClipSegments(
  durationSec: number,
  captions: CaptionSegment[],
  segments?: ClipEditSegment[]
): ClipEditSegment[] {
  return segments && segments.length > 0 ? segments : buildClipSegments(durationSec, captions);
}

export function setClipSilenceEnabled(segments: ClipEditSegment[], enabled: boolean): ClipEditSegment[] {
  return segments.map((segment) => (segment.kind === "silence" ? { ...segment, enabled } : segment));
}

/** Moves a shared boundary while keeping the timeline tiled and usable. */
export function resizeClipSegmentBoundary(
  segments: ClipEditSegment[],
  leftId: string,
  nextBoundary: number
): ClipEditSegment[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const index = sorted.findIndex((segment) => segment.id === leftId);
  if (index < 0 || index >= sorted.length - 1) return segments;
  const left = sorted[index];
  const right = sorted[index + 1];
  const boundary = round3(
    Math.max(left.start + MIN_SEGMENT_SEC, Math.min(right.end - MIN_SEGMENT_SEC, nextBoundary))
  );
  sorted[index] = { ...left, end: boundary };
  sorted[index + 1] = { ...right, start: boundary };
  return sorted;
}

export type ClipKeptRange = { start: number; end: number };

export function keptClipRanges(
  durationSec: number,
  trimStart: number,
  trimEnd: number,
  segments?: ClipEditSegment[]
): ClipKeptRange[] {
  const duration = Math.max(0.1, durationSec);
  const start = Math.max(0, Math.min(trimStart || 0, duration));
  const end = Math.max(start + 0.1, Math.min(trimEnd || duration, duration));
  const source =
    segments && segments.length > 0
      ? [...segments].sort((a, b) => a.start - b.start)
      : [{ id: "clip-seg-1", start: 0, end: duration, kind: "speech" as const, enabled: true }];
  const ranges: ClipKeptRange[] = [];
  for (const segment of source) {
    if (!segment.enabled) continue;
    const rangeStart = Math.max(start, segment.start);
    const rangeEnd = Math.min(end, segment.end);
    if (rangeEnd - rangeStart < MIN_SEGMENT_SEC) continue;
    const last = ranges[ranges.length - 1];
    if (last && rangeStart - last.end < 0.002) last.end = Math.max(last.end, rangeEnd);
    else ranges.push({ start: round3(rangeStart), end: round3(rangeEnd) });
  }
  return ranges;
}

export function clipEditedDurationSec(
  durationSec: number,
  trimStart: number,
  trimEnd: number,
  segments?: ClipEditSegment[]
): number {
  return round3(
    keptClipRanges(durationSec, trimStart, trimEnd, segments).reduce(
      (sum, range) => sum + (range.end - range.start),
      0
    )
  );
}

export function cutClipRanges(
  durationSec: number,
  trimStart: number,
  trimEnd: number,
  segments?: ClipEditSegment[]
): ClipKeptRange[] {
  const duration = Math.max(0.1, durationSec);
  const kept = keptClipRanges(duration, trimStart, trimEnd, segments);
  const cuts: ClipKeptRange[] = [];
  let cursor = 0;
  for (const range of kept) {
    if (range.start - cursor >= MIN_SEGMENT_SEC) cuts.push({ start: cursor, end: range.start });
    cursor = range.end;
  }
  if (duration - cursor >= MIN_SEGMENT_SEC) cuts.push({ start: cursor, end: duration });
  return cuts;
}

export function sourceTimeToClipOutput(sourceTime: number, ranges: ClipKeptRange[]): number | null {
  if (ranges.length === 0) return null;
  let output = 0;
  for (const range of ranges) {
    if (sourceTime >= range.start && sourceTime <= range.end) {
      return round3(output + sourceTime - range.start);
    }
    if (sourceTime < range.start) return round3(output);
    output += range.end - range.start;
  }
  return round3(output);
}

export function sourceToClipIntervals(
  sourceStart: number,
  sourceEnd: number,
  ranges: ClipKeptRange[]
): ClipKeptRange[] {
  const intervals: ClipKeptRange[] = [];
  let output = 0;
  for (const range of ranges) {
    const start = Math.max(sourceStart, range.start);
    const end = Math.min(sourceEnd, range.end);
    if (end - start >= MIN_SEGMENT_SEC) {
      intervals.push({
        start: round3(output + start - range.start),
        end: round3(output + end - range.start)
      });
    }
    output += range.end - range.start;
  }
  return intervals;
}

export function remapClipCaptions(
  captions: CaptionSegment[],
  ranges: ClipKeptRange[]
): CaptionSegment[] {
  const output: CaptionSegment[] = [];
  for (const caption of captions) {
    if (!caption.enabled || !caption.text.trim()) continue;
    const intervals = sourceToClipIntervals(caption.start, caption.end, ranges);
    if (intervals.length === 0) continue;
    const start = intervals[0].start;
    const end = intervals[intervals.length - 1].end;
    const words: CaptionWord[] = [];
    for (const word of caption.words) {
      const wordStart = sourceTimeToClipOutput(word.start, ranges);
      const wordEnd = sourceTimeToClipOutput(word.end, ranges);
      if (wordStart === null || wordEnd === null) continue;
      const clampedStart = Math.max(start, Math.min(end, wordStart));
      const clampedEnd = Math.max(clampedStart, Math.min(end, wordEnd));
      words.push({ ...word, start: clampedStart, end: clampedEnd });
    }
    output.push({ ...caption, id: "cap-" + (output.length + 1), start, end, words });
  }
  return output;
}

export function remapClipOverlays(
  overlays: Overlay[],
  ranges: ClipKeptRange[],
  durationSec: number
): Overlay[] {
  return overlays.flatMap((overlay) => {
    const end = overlay.end > overlay.start ? overlay.end : durationSec;
    return sourceToClipIntervals(overlay.start, end, ranges).map((interval, index) => ({
      ...overlay,
      id: overlay.id + "-part-" + (index + 1),
      start: interval.start,
      end: interval.end
    }));
  });
}
