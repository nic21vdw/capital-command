import type { EdlSegment, Unit } from "@/lib/story/types";

export type ShotKind = "wide" | "screen" | "face";

export type Pane = { x0: number; y0: number; x1: number; y1: number };

export type FocusWindow = { x: number; y: number; share: number; motion: number };

export const SCREEN_ZOOM = 1.4;
export const MIN_HOLD_SEC = 5;
export const ESTABLISH_SEC = 3;
export const FACE_MIN_SEC = 1.5;
export const FACE_MAX_SEC = 3.5;
export const FACE_SPACING_SEC = 45;
export const MAX_FACE_SHOTS = 6;

const SCREEN_TALK =
  /\blook at\b|\bright here\b|\bthis (is|one|right|part|page|site|website|thing)\b|\bcheck (this|out)\b|\bsee (this|that|what)\b|website|homepage|\bsite\b|terminal|usage|\d+ ?%|pricing|services|questions|mobile|page|card|designer|wall|transparency|dashboard|button|settings|code|agent|session|loop|model|cli|codex|claude/i;

const REACTION = /!|\bholy\b|\bwow\b|\boh (my|no|chat|guys|shoot)\b|\bno way\b|\binsane\b|\bgorgeous\b|\bcrazy\b|\bflashbang\b|\bbaby\b|\blet's go\b|\bi got\b|\bmogs\b|\bdisaster\b/i;

export function screenTalk(text: string): boolean {
  return SCREEN_TALK.test(text);
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
  focus: Map<string, FocusWindow>;
  pane: Pane | null;
  width: number;
  height: number;
  faceVisible?: (segment: EdlSegment) => boolean;
};

export function planShots(input: ShotInput): EdlSegment[] {
  const { units, focus, pane } = input;
  const eligible = input.faceVisible ? input.segments.filter((segment) => input.faceVisible!(segment)) : input.segments;
  const reactions = pane ? pickReactions(eligible, units) : new Set<string>();
  const face = pane ? faceFraming(pane, input.width, input.height) : null;
  let current: { kind: Exclude<ShotKind, "face">; since: number; x: number; y: number } = { kind: "wide", since: 0, x: 0.5, y: 0.5 };
  let sectionStart = 0;

  return input.segments.map((segment) => {
    if (!segment.enabled) return segment;
    const unit = units.get(segment.unitId);
    const newSection = segment.transition === "j-cut" || segment.transition === "cut";
    if (newSection) {
      sectionStart = segment.timelineIn;
      current = { kind: "wide", since: segment.timelineIn, x: 0.5, y: 0.5 };
    }

    if (face && reactions.has(segment.id)) {
      return withShot(segment, face.zoom, face.x, face.y, "face", "brief cut to the camera for the reaction");
    }

    const held = segment.timelineIn - current.since;
    const established = segment.timelineIn - sectionStart >= ESTABLISH_SEC;
    const window = focus.get(segment.unitId);
    const wantsScreen = Boolean(unit && window && screenTalk(unit.text));
    if (!newSection && established && held >= MIN_HOLD_SEC) {
      if (wantsScreen && current.kind === "wide") current = { kind: "screen", since: segment.timelineIn, x: window!.x, y: window!.y };
      else if (!wantsScreen && current.kind === "screen") current = { kind: "wide", since: segment.timelineIn, x: 0.5, y: 0.5 };
    }

    if (current.kind === "screen") {
      return withShot(segment, SCREEN_ZOOM, current.x, current.y, "screen", "held on the part of the screen being talked about");
    }
    const push = segment.zoomTo > segment.zoom;
    return withShot(segment, push ? segment.zoom : 1, 0.5, 0.5, "wide", push ? `slow push-in to ${Math.round(segment.zoomTo * 100)}% on a key line` : "wide shot");
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
