import type { ClipLayoutOverrides, ClipLayoutPreset } from "@/lib/clipping/types";
import type { ClipCompositionMode } from "@/types/domain";

export type Rect = { x: number; y: number; w: number; h: number };

/** Editor composition modes that render through the shared layout geometry. */
export const LAYOUT_MODE_PRESETS: Partial<Record<ClipCompositionMode, ClipLayoutPreset>> = {
  "stacked-split": "restream-stack",
  "stacked-split-flip": "face-stack",
  "screen-lead": "screen-focus",
  "face-lead": "face-focus"
};
export type LayoutLayer = { source: Rect; dest: Rect; kind: "screen" | "face"; fit?: "cover" | "contain" };
export type ClipLayoutDefinition = {
  label: string;
  description: string;
  previewHint: string;
  layers: LayoutLayer[];
};

/**
 * Default face-camera region: streamers usually park the camera overlay in the
 * top-right corner of the screen. Projects can override this per clip.
 */
export const DEFAULT_FACE_SOURCE: Rect = { x: 0.58, y: 0.05, w: 0.42, h: 0.5 };
const streamerCameraSource = DEFAULT_FACE_SOURCE;

/** Default screen region: the whole source frame. Projects can shrink this to
 *  crop out the camera overlay and zoom in on the screen content. */
export const DEFAULT_SCREEN_SOURCE: Rect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Layout geometry rules (all rects are normalized to the 9:16 output frame):
 * - Screen layers use `contain` so no screen content is ever cropped away —
 *   the blurred base fills any letterbox space.
 * - Face layers use `cover` so the camera always fills its slot edge-to-edge
 *   (cropping a webcam feed is fine; bars around a face look broken).
 */
export const CLIP_LAYOUTS: Record<ClipLayoutPreset, ClipLayoutDefinition> = {
  center: {
    label: "Centered vertical",
    description: "A classic Shorts crop over a blurred fill.",
    previewHint: "Best when the source is already framed vertically or the speaker is centered.",
    layers: [{ kind: "screen", fit: "contain", source: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 0, y: 0.22, w: 1, h: 0.56 } }]
  },
  "restream-stack": {
    label: "Screen + face",
    description: "Split layout: full screen up top, camera reaction below.",
    previewHint: "Best for screen-share streams with the camera overlay in the top-right.",
    layers: [
      { kind: "screen", fit: "contain", source: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 0, y: 0.06, w: 1, h: 0.42 } },
      { kind: "face", fit: "cover", source: streamerCameraSource, dest: { x: 0, y: 0.5, w: 1, h: 0.44 } }
    ]
  },
  "face-stack": {
    label: "Face + screen",
    description: "Flipped split: camera reaction up top, full screen below.",
    previewHint: "Best when the reaction is the star and the screen is supporting context.",
    layers: [
      { kind: "face", fit: "cover", source: streamerCameraSource, dest: { x: 0, y: 0.06, w: 1, h: 0.44 } },
      { kind: "screen", fit: "contain", source: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 0, y: 0.52, w: 1, h: 0.42 } }
    ]
  },
  "screen-focus": {
    label: "Screen lead",
    description: "The full screen leads with a small face inset overlaid below it.",
    previewHint: "Best when the screen content is the point and the face is supporting context.",
    layers: [
      { kind: "screen", fit: "contain", source: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 0, y: 0.12, w: 1, h: 0.44 } },
      { kind: "face", fit: "cover", source: streamerCameraSource, dest: { x: 0.56, y: 0.6, w: 0.38, h: 0.24 } }
    ]
  },
  "face-focus": {
    label: "Face lead",
    description: "Face-first layout with the screen retained as a context banner.",
    previewHint: "Best for reaction, commentary, and talking-head moments from screen-share streams.",
    layers: [
      { kind: "screen", fit: "contain", source: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 0.05, y: 0.06, w: 0.9, h: 0.26 } },
      { kind: "face", fit: "cover", source: streamerCameraSource, dest: { x: 0, y: 0.36, w: 1, h: 0.56 } }
    ]
  }
};

export const DEFAULT_CLIP_LAYOUT: ClipLayoutPreset = "restream-stack";

function cloneRect(rect: Rect): Rect {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

function normalizeRect(rect: Rect): Rect {
  const x = Math.min(0.99, Math.max(0, Number.isFinite(rect.x) ? rect.x : 0));
  const y = Math.min(0.99, Math.max(0, Number.isFinite(rect.y) ? rect.y : 0));
  const w = Math.max(0.01, Math.min(1 - x, Number.isFinite(rect.w) ? rect.w : 1));
  const h = Math.max(0.01, Math.min(1 - y, Number.isFinite(rect.h) ? rect.h : 1));
  return { x, y, w, h };
}

export function resolveClipLayout(
  layout: ClipLayoutPreset = DEFAULT_CLIP_LAYOUT,
  overrides?: ClipLayoutOverrides
): ClipLayoutDefinition {
  const definition = CLIP_LAYOUTS[layout] ?? CLIP_LAYOUTS[DEFAULT_CLIP_LAYOUT];
  const override = overrides?.[layout];
  return {
    ...definition,
    layers: definition.layers.map((layer, index) => {
      const layerOverride = override?.layers?.[index];
      return {
        ...layer,
        source: normalizeRect(layerOverride?.source ?? cloneRect(layer.source)),
        dest: normalizeRect(layerOverride?.dest ?? cloneRect(layer.dest)),
        fit: layerOverride?.fit ?? layer.fit
      };
    })
  };
}

/** Replaces the face-camera source rect across every face layer of a layout. */
export function withFaceSource(
  definition: ClipLayoutDefinition,
  faceSource: Rect | undefined
): ClipLayoutDefinition {
  return withLayerSources(definition, { face: faceSource });
}

/** Replaces the source rects of a layout's layers by kind (face camera and/or
 *  screen). Undefined entries leave that kind's sources untouched. */
export function withLayerSources(
  definition: ClipLayoutDefinition,
  sources: { face?: Rect; screen?: Rect }
): ClipLayoutDefinition {
  const face = sources.face ? normalizeRect(sources.face) : undefined;
  const screen = sources.screen ? normalizeRect(sources.screen) : undefined;
  if (!face && !screen) return definition;
  return {
    ...definition,
    layers: definition.layers.map((layer) => {
      const source = layer.kind === "face" ? face : screen;
      return source ? { ...layer, source } : layer;
    })
  };
}

export function getFaceSource(
  layout: ClipLayoutPreset = DEFAULT_CLIP_LAYOUT,
  overrides?: ClipLayoutOverrides
): Rect {
  const definition = resolveClipLayout(layout, overrides);
  return cloneRect(definition.layers.find((layer) => layer.kind === "face")?.source ?? definition.layers[0]?.source ?? { x: 0, y: 0, w: 1, h: 1 });
}
