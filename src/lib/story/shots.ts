import type { EdlSegment, Unit } from "@/lib/story/types";

export type ShotKind = "wide" | "screen" | "face";

export type Pane = { x0: number; y0: number; x1: number; y1: number };

export type Pointer = { x: number; y: number; sightings: number; zoom?: number };

export const SCREEN_ZOOM = 1.5;
export const MIN_HOLD_SEC = 5;
export const FACE_MIN_SEC = 1.5;
export const FACE_MAX_SEC = 3.5;
export const FACE_SPACING_SEC = 45;
export const MAX_FACE_SHOTS = 6;

const SMALL_REFERENCE =
  /\blook at (this|that|these|it)\b|\bright here\b|\bright there\b|\bthis (button|number|bar|card|part|little|tab|box|line|icon|toggle|price|one right)\b|\bsee (this|that|these)\b|\d+ ?%|\$ ?\d|\bpricing\b|\bfrequently asked\b|\bcheck (this|it) out\b|\blook at all\b/i;

const REACTION = /!|\bholy\b|\bwow\b|\boh (my|no|chat|guys|shoot)\b|\bno way\b|\binsane\b|\bgorgeous\b|\bcrazy\b|\bflashbang\b|\bbaby\b|\blet's go\b|\bi got\b|\bmogs\b|\bdisaster\b/i;

export function screenTalk(text: string): boolean {
  return SMALL_REFERENCE.test(text);
}

export function reactionScore(unit: Unit): number {
  const hits = (unit.text.match(new RegExp(REACTION.source, "gi")) ?? []).length;
  if (hits === 0) return 0;
  return hits * 0.4 + unit.audio.energy * 0.4 + unit.scores.emotion * 0.2 + unit.visual.gesture * 0.2;
}

export function faceFraming(pane: Pane, width: number, height: number): { zoom: number; x: number; y: number } {
  const paneW = (pane.x1 - pane.x0) * width;
  const paneH = (pane.y1 - pane.y0) * height;
  const aspect = width / height;
  const cropW = Math.min(paneW, paneH * aspect);
  return {
    zoom: Math.round((width / cropW) * 1000) / 1000,
    x: (pane.x0 + pane.x1) / 2,
    y: pane.y0 + (cropW / aspect / height) / 2
  };
}

export function pickReactions(segments: EdlSegment[], units: Map<string, Unit>): Set<string> {
  const candidates = segments
    .filter((segment) => segment.enabled)
    .map((segment) => ({ segment, duration: segment.out - segment.in, score: reactionScore(units.get(segment.unitId)!) }))
    .filter(({ segment }) => {
      const text = units.get(segment.unitId)?.text ?? "";
      return !/\bright here\b|\blook at\b/i.test(text) || text.includes("!");
    })
    .filter(({ duration, score }) => score > 0 && duration >= FACE_MIN_SEC && duration <= FACE_MAX_SEC)
    .sort((a, b) => b.score - a.score);
  const chosen: EdlSegment[] = [];
  for (const { segment } of candidates) {
    if (chosen.length >= MAX_FACE_SHOTS) break;
    if (chosen.some((other) => Math.abs(other.timelineIn - segment.timelineIn) < FACE_SPACING_SEC)) continue;
    chosen.push(segment);
  }
  return new Set(chosen.map((segment) => segment.id));
}

export type ShotInput = {
  segments: EdlSegment[];
  units: Map<string, Unit>;
  pointers: Map<string, Pointer>;
  pane: Pane | null;
  width: number;
  height: number;
  faceVisible?: (segment: EdlSegment) => boolean;
};

export function planShots(input: ShotInput): EdlSegment[] {
  const { units, pointers, pane } = input;
  const eligible = input.faceVisible ? input.segments.filter((segment) => input.faceVisible!(segment)) : input.segments;
  const reactions = pane ? pickReactions(eligible, units) : new Set<string>();
  const face = pane ? faceFraming(pane, input.width, input.height) : null;
  let wideSince = 0;
  let lastZoomUnit = "";

  return input.segments.map((segment) => {
    if (!segment.enabled) return segment;
    const unit = units.get(segment.unitId);
    if (segment.transition === "j-cut" || segment.transition === "cut") wideSince = segment.timelineIn;

    if (face && reactions.has(segment.id)) {
      return withShot(segment, face.zoom, face.x, face.y, "face", "brief cut to the camera for the reaction");
    }

    const pointer = pointers.get(segment.unitId);
    const pointing = Boolean(unit && pointer && screenTalk(unit.text));
    const continuing = pointing && lastZoomUnit === segment.unitId;
    if (pointing && (continuing || segment.timelineIn - wideSince >= MIN_HOLD_SEC)) {
      lastZoomUnit = segment.unitId;
      return withShot(
        segment,
        pointer!.zoom ?? SCREEN_ZOOM,
        pointer!.x,
        pointer!.y,
        "screen",
        pointer!.sightings > 0 ? "zoomed on the mouse pointer while he points at something small" : "zoomed on the small thing that appeared where he is pointing"
      );
    }
    if (lastZoomUnit && lastZoomUnit !== segment.unitId) {
      lastZoomUnit = "";
      wideSince = segment.timelineIn;
    }
    const push = segment.zoomTo > segment.zoom;
    return withShot(segment, push ? segment.zoom : 1, 0.5, 0.5, "wide", push ? `slow push-in to ${Math.round(segment.zoomTo * 100)}% on a key line` : "whole screen");
  });
}

function withShot(segment: EdlSegment, zoom: number, x: number, y: number, kind: ShotKind, note: string): EdlSegment {
  const keepPush = kind === "wide" && segment.zoomTo > segment.zoom;
  const base = segment.reason.split("; ")[0];
  return {
    ...segment,
    zoom,
    zoomTo: keepPush ? segment.zoomTo : zoom,
    anchorX: x,
    anchorY: y,
    shot: kind,
    reason: `${base}; ${segment.transition === "jump" ? "jump cut over a removed filler or pause; " : ""}${kind} shot: ${note}`
  };
}

export function summarizeShots(segments: EdlSegment[]): { changes: number; face: number; screen: number; wide: number } {
  let changes = 0;
  let previous = "";
  const counts = { face: 0, screen: 0, wide: 0 };
  for (const segment of segments.filter((entry) => entry.enabled)) {
    const key = `${segment.shot}:${segment.zoom}:${segment.anchorX}:${segment.anchorY}`;
    if (previous && key !== previous) changes++;
    if (key !== previous && segment.shot) counts[segment.shot]++;
    previous = key;
  }
  return { changes, ...counts };
}
