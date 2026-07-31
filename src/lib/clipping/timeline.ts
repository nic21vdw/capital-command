import type { CaptionSegment, CaptionWord } from "@/types/domain";

/**
 * Geometry for showing a clip against the WHOLE stream it was cut from, and for
 * moving its in/out points around inside that stream. Everything here is in
 * absolute source seconds — the same coordinate space as `ClipCandidate.start`
 * / `.end` — because the point of these views is to place a clip in the source,
 * not inside itself. (The Clip Editor's timeline is the opposite: clip-relative
 * throughout. Don't mix the two.)
 *
 * Pure and framework-free so the maths is tested without a DOM.
 */

export type TimeRange = { start: number; end: number };

/** Shortest and longest clip a re-cut may produce. */
export const MIN_RECUT_SEC = 3;
/**
 * A ceiling on re-cuts, not on clipping in general: every re-cut re-renders a
 * captioned 9:16 vertical, and past a quarter of an hour that is a long-form
 * export wearing a clip's clothes — the Long-Form Editor is the tool for that.
 */
export const MAX_RECUT_SEC = 900;

/** Context shown either side of a clip in the range editor, tightest first. */
export const CONTEXT_PADDINGS = [15, 60, 300, 1800];

const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];

/** The largest round interval that still puts at least `targetTicks` labels on a span. */
export function rulerStep(spanSec: number, targetTicks = 8): number {
  const ideal = Math.max(1, spanSec) / Math.max(1, targetTicks);
  return RULER_STEPS.find((step) => step >= ideal) ?? RULER_STEPS[RULER_STEPS.length - 1];
}

export function rulerTicks(startSec: number, endSec: number, step = rulerStep(endSec - startSec)): number[] {
  const ticks: number[] = [];
  for (let tick = Math.ceil(startSec / step) * step; tick <= endSec; tick += step) ticks.push(tick);
  return ticks;
}

/**
 * Assigns each range a row so nothing overlaps its neighbour on screen. A clip
 * is a few seconds of a stream that runs for hours, so `minSpanSec` widens each
 * range to whatever the view will actually draw (a hairline band still needs a
 * few pixels to be clickable) — otherwise two clips a second apart would be
 * packed into one row and render on top of each other.
 *
 * Returns lane indexes positionally: `lanes[i]` is the row for `ranges[i]`.
 */
export function packLanes(ranges: TimeRange[], minSpanSec = 0): number[] {
  const laneEnds: number[] = [];
  const lanes = new Array<number>(ranges.length).fill(0);
  const byStart = ranges.map((_, index) => index).sort((a, b) => ranges[a].start - ranges[b].start);
  for (const index of byStart) {
    const range = ranges[index];
    const reach = Math.max(range.end, range.start + minSpanSec);
    let lane = laneEnds.findIndex((end) => end <= range.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(reach);
    } else {
      laneEnds[lane] = reach;
    }
    lanes[index] = lane;
  }
  return lanes;
}

const round = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * Holds a proposed clip range inside the source and inside the allowed length.
 * `anchor` names the edge the creator is NOT dragging, so pushing one handle
 * past the other stops it dead instead of dragging the whole clip along.
 */
export function clampRange(
  range: TimeRange,
  {
    durationSec,
    anchor = "start",
    minSec = MIN_RECUT_SEC,
    maxSec = MAX_RECUT_SEC
  }: { durationSec: number; anchor?: "start" | "end"; minSec?: number; maxSec?: number }
): TimeRange {
  const limit = Math.max(minSec, durationSec || range.end);
  const min = Math.min(minSec, limit);
  const max = Math.max(min, Math.min(maxSec, limit));
  let start: number;
  let end: number;
  if (anchor === "end") {
    end = Math.min(Math.max(range.end, min), limit);
    start = Math.min(Math.max(range.start, 0), end - min);
    if (end - start > max) start = end - max;
  } else {
    start = Math.min(Math.max(range.start, 0), limit - min);
    end = Math.min(Math.max(range.end, start + min), limit);
    if (end - start > max) end = start + max;
  }
  return { start: round(start), end: round(end) };
}

/**
 * The slice of the stream drawn around a clip while its in/out points are being
 * moved: the clip plus `paddingSec` of context each side, slid back inside the
 * source when it runs off either end so the view keeps its full width at the
 * very start and very end of a stream.
 */
export function contextWindow(
  range: TimeRange,
  { durationSec, paddingSec }: { durationSec: number; paddingSec: number }
): TimeRange {
  const limit = Math.max(range.end, durationSec || range.end);
  const span = Math.min(limit, range.end - range.start + paddingSec * 2);
  let start = Math.max(0, range.start - paddingSec);
  let end = start + span;
  if (end > limit) {
    end = limit;
    start = Math.max(0, end - span);
  }
  return { start, end };
}

/** Ranges that touch [start, end], clipped to it. Keeps overlays bounded on long streams. */
export function rangesWithin<T extends TimeRange>(ranges: T[], start: number, end: number): TimeRange[] {
  return ranges
    .filter((range) => range.end > start && range.start < end)
    .map((range) => ({ start: Math.max(range.start, start), end: Math.min(range.end, end) }));
}

export type SpokenWord = CaptionWord & { inside: boolean };

/**
 * The transcript around a clip, each word flagged for whether the current in/out
 * points include it. This is what makes extending a clip a reading task rather
 * than a guessing one: the sentence the cut lands mid-way through is right
 * there, greyed out, waiting to be pulled in.
 */
export function spokenAround(
  segments: CaptionSegment[],
  range: TimeRange,
  window: TimeRange
): SpokenWord[] {
  const words: SpokenWord[] = [];
  for (const segment of segments) {
    if (segment.end <= window.start || segment.start >= window.end) continue;
    const source: CaptionWord[] = segment.words.length
      ? segment.words
      : [{ text: segment.text, start: segment.start, end: segment.end }];
    for (const word of source) {
      if (word.end <= window.start || word.start >= window.end) continue;
      words.push({ ...word, inside: word.end > range.start && word.start < range.end });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

/**
 * The nearest point a cut can land on without slicing a word in half: the edge
 * of the gap between words. Returns `null` when nothing is close enough to be
 * what the creator meant, so a drag in an unspoken stretch is left alone.
 */
export function snapToSpeech(
  seconds: number,
  segments: CaptionSegment[],
  edge: "start" | "end",
  toleranceSec = 1.5
): number | null {
  let best: number | null = null;
  let bestGap = toleranceSec;
  for (const segment of segments) {
    if (segment.end < seconds - toleranceSec || segment.start > seconds + toleranceSec) continue;
    const source: CaptionWord[] = segment.words.length
      ? segment.words
      : [{ text: segment.text, start: segment.start, end: segment.end }];
    for (const word of source) {
      const candidate = edge === "start" ? word.start : word.end;
      const gap = Math.abs(candidate - seconds);
      if (gap < bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
  }
  return best === null ? null : round(best);
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parses `1:02:03`, `2:03` or `123` back into seconds; `null` when it isn't a timecode. */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d*\.?\d*$/.test(part) || part === "")) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) ? round(seconds) : null;
}
