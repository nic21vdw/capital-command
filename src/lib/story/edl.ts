import { cleanRange, snapToQuiet, type WordFlag } from "@/lib/story/cleanup";
import { TALKING_HEAD_FACE_HEIGHT } from "@/lib/story/scoring";
import type { Edl, EdlSegment, Removal, SectionRole, Transition, Unit, VisualSample, Word } from "@/lib/story/types";

export const PUSH_FROM = 1;
export const PUSH_TO = 1.08;
export const PUSH_MIN_SEC = 3;
export const PUSH_MAX_SEC = 6;
export const MAX_ZOOM = 1.2;
export const SECTION_AUDIO_LEAD_SEC = 0.3;
const MIN_SEGMENT_FRAMES = 3;

export type EdlUnit = { unit: Unit; section: SectionRole; key: boolean; dramatic: boolean; tag?: string };

export type Anchor = { x: number; y: number; source: "face" | "frame" };

export function zoomAnchor(samples: VisualSample[]): Anchor {
  const faces = samples.map((sample) => sample.face).filter((face): face is NonNullable<typeof face> => Boolean(face));
  if (faces.length < samples.length * 0.5 || faces.length === 0) return { x: 0.5, y: 0.5, source: "frame" };
  const heights = faces.map((face) => face.h).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)];
  if (medianHeight < TALKING_HEAD_FACE_HEIGHT) return { x: 0.5, y: 0.5, source: "frame" };
  const xs = faces.map((face) => face.x + face.w / 2).sort((a, b) => a - b);
  const ys = faces.map((face) => face.y + face.h / 2).sort((a, b) => a - b);
  return { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)], source: "face" };
}

export function silenceThreshold(envelope: Float32Array, hopSec: number, time: number): number {
  const from = Math.max(0, Math.floor((time - 2) / hopSec));
  const to = Math.min(envelope.length, Math.ceil((time + 2) / hopSec));
  const window = Array.from(envelope.subarray(from, to)).sort((a, b) => a - b);
  if (window.length === 0) return -40;
  const floor = window[Math.floor(window.length * 0.1)];
  const loud = window[Math.floor(window.length * 0.9)];
  return floor + (loud - floor) * 0.35;
}

export function quantize(seconds: number, fps: number): number {
  return Math.round(seconds * fps) / fps;
}

export type BuildEdlInput = {
  source: string;
  fps: number;
  width: number;
  height: number;
  words: Word[];
  flags: WordFlag[];
  units: EdlUnit[];
  envelope: Float32Array | null;
  hopSec: number;
  anchorFor: (start: number, end: number) => Anchor;
  zoomOverrides?: Record<string, number>;
};

export type BuiltEdl = { edl: Edl; removals: Removal[] };

export function buildEdl(input: BuildEdlInput): BuiltEdl {
  const flagged = new Map(input.flags.map((flag) => [flag.index, flag.kind]));
  const segments: EdlSegment[] = [];
  const removals: Removal[] = [];
  let previousUnit: Unit | null = null;
  let previousSection: SectionRole | null = null;
  let cursor = 0;

  for (const entry of input.units) {
    const { unit } = entry;
    const dramatic = new Set<number>(entry.dramatic ? [unit.lastWord] : []);
    const cleaned = cleanRange(input.words, unit.firstWord, unit.lastWord, flagged, dramatic);
    removals.push(...cleaned.removals);
    const sectionChange = previousSection !== null && previousSection !== entry.section;
    const adjacent = previousUnit !== null && unit.start >= previousUnit.end && unit.start - previousUnit.end < 3;

    let pushed = false;
    cleaned.ranges.forEach((range, index) => {
      const words = input.words;
      const before = range.firstWord > 0 ? words[range.firstWord - 1] : null;
      const after = words[range.lastWord + 1] ?? null;
      const first = words[range.firstWord];
      const last = words[range.lastWord];
      const startRaw = snapToQuiet(range.start, input.envelope, input.hopSec, before ? before.e : 0, first.s);
      const endRaw = snapToQuiet(range.end, input.envelope, input.hopSec, last.e, after ? after.s : range.end + 1);
      const inPoint = quantize(startRaw, input.fps);
      const outPoint = quantize(endRaw, input.fps);
      if (outPoint - inPoint < MIN_SEGMENT_FRAMES / input.fps) return;

      let transition: Transition = "jump";
      if (segments.length === 0) transition = "cut";
      else if (index === 0 && sectionChange) transition = "j-cut";
      else if (index === 0 && !adjacent) transition = "cut";

      const anchor = input.anchorFor(inPoint, outPoint);
      let zoom = 1;
      let zoomTo = 1;
      const duration = outPoint - inPoint;
      if (entry.key && !pushed && duration >= PUSH_MIN_SEC) {
        pushed = true;
        zoom = PUSH_FROM;
        zoomTo = PUSH_TO;
      }

      const id = `${entry.tag ? `${entry.tag}-` : ""}${unit.id}.${index + 1}`;
      segments.push({
        id,
        unitId: unit.id,
        section: entry.section,
        source: input.source,
        in: inPoint,
        out: outPoint,
        timelineIn: cursor,
        timelineOut: cursor + duration,
        zoom,
        zoomTo,
        anchorX: anchor.x,
        anchorY: anchor.y,
        transition,
        audioLeadSec: transition === "j-cut" ? SECTION_AUDIO_LEAD_SEC : 0,
        enabled: true,
        reason: segmentReason(entry, transition, zoom, zoomTo, unit.reason),
        audioScore: unit.scores.audio,
        visualScore: unit.scores.visual,
        scores: unit.scores
      });
      cursor += duration;
    });
    previousUnit = unit;
    previousSection = entry.section;
  }

  const merged = mergeBreaths(segments, input.words, flagged);
  const runtimeSec = merged.reduce((sum, segment) => sum + segment.out - segment.in, 0);
  return {
    edl: { version: 1, source: input.source, fps: input.fps, width: input.width, height: input.height, segments: merged, runtimeSec },
    removals
  };
}

export const MERGE_GAP_SEC = 0.3;

export function mergeBreaths(segments: EdlSegment[], words: Word[], flagged: Map<number, unknown>): EdlSegment[] {
  const out: EdlSegment[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const previous = out[out.length - 1];
    const gap = previous ? segment.in - previous.out : Infinity;
    const removedBetween =
      previous !== undefined &&
      words.some((word, index) => flagged.has(index) && word.e > previous.out && word.s < segment.in);
    if (previous && segment.transition === "jump" && gap >= 0 && gap <= MERGE_GAP_SEC && !removedBetween && previous.section === segment.section) {
      previous.out = segment.out;
      cursor = previous.timelineIn + (previous.out - previous.in);
      previous.timelineOut = cursor;
      continue;
    }
    const duration = segment.out - segment.in;
    out.push({ ...segment, timelineIn: cursor, timelineOut: cursor + duration });
    cursor += duration;
  }
  return out;
}

export function clampZoom(zoom: number): number {
  return Math.max(1, Math.min(MAX_ZOOM, Math.round(zoom * 1000) / 1000));
}

function segmentReason(entry: EdlUnit, transition: Transition, zoom: number, zoomTo: number, unitReason: string): string {
  const parts = [`${entry.section}: ${unitReason}`];
  if (transition === "jump") parts.push("jump cut over a removed filler or pause");
  if (transition === "j-cut") parts.push("J-cut into a new section so the next line leads the picture");
  if (zoomTo > zoom) parts.push(`slow push-in ${Math.round(zoom * 100)}% to ${Math.round(zoomTo * 100)}% on a key line`);
  else if (zoom > 1) parts.push(`punch-in to ${Math.round(zoom * 100)}% so the jump cut reads as intentional`);
  return parts.join("; ");
}

export function retime(segments: EdlSegment[]): { segments: EdlSegment[]; runtimeSec: number } {
  let cursor = 0;
  const out = segments.map((segment) => {
    if (!segment.enabled) return { ...segment, timelineIn: cursor, timelineOut: cursor };
    const duration = segment.out - segment.in;
    const next = { ...segment, timelineIn: cursor, timelineOut: cursor + duration };
    cursor += duration;
    return next;
  });
  return { segments: out, runtimeSec: cursor };
}

export function sourceToTimeline(segments: EdlSegment[], sourceTime: number): number | null {
  for (const segment of segments) {
    if (!segment.enabled) continue;
    if (sourceTime >= segment.in && sourceTime <= segment.out) return segment.timelineIn + (sourceTime - segment.in);
  }
  return null;
}

export type TimelineWord = { w: string; s: number; e: number };

export function timelineWords(segments: EdlSegment[], words: Word[]): TimelineWord[] {
  const out: TimelineWord[] = [];
  const sorted = words;
  for (const segment of segments) {
    if (!segment.enabled) continue;
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (sorted[mid].e <= segment.in) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < sorted.length && sorted[i].s < segment.out; i++) {
      const word = sorted[i];
      const middle = (word.s + word.e) / 2;
      if (middle < segment.in || middle > segment.out) continue;
      out.push({
        w: word.w,
        s: segment.timelineIn + Math.max(0, word.s - segment.in),
        e: segment.timelineIn + Math.min(segment.out, word.e) - segment.in
      });
    }
  }
  return out;
}
