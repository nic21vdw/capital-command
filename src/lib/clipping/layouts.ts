import type { ClipLayoutOverrides, ClipLayoutPreset } from "@/lib/clipping/types";

export type Rect = { x: number; y: number; w: number; h: number };
export type LayoutLayer = { source: Rect; dest: Rect; kind: "screen" | "face"; fit?: "cover" | "contain" };
export type ClipLayoutDefinition = {
  label: string;
  description: string;
  previewHint: string;
  layers: LayoutLayer[];
};

const streamerCameraSource: Rect = { x: 0.58, y: 0.05, w: 0.42, h: 0.5 };

export const CLIP_LAYOUTS: Record<ClipLayoutPreset, ClipLayoutDefinition> = {
  center: {
    label: "Centered vertical",
    description: "A classic Shorts crop over a blurred fill.",
    previewHint: "Best when the source is already framed vertically or the speaker is centered.",
    layers: [{ kind: "screen", source: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 0.08, y: 0.22, w: 0.84, h: 0.56 } }]
  },
  "restream-stack": {
    label: "Screen + face",
    description: "Restream-style split: screen up top, camera reaction below.",
    previewHint: "Best for screen-share streams with the camera overlay in the top-right.",
    layers: [
      { kind: "screen", source: { x: 0, y: 0, w: 1, h: 0.68 }, dest: { x: 0, y: 0, w: 1, h: 0.56 } },
      { kind: "face", fit: "contain", source: streamerCameraSource, dest: { x: 0, y: 0.56, w: 1, h: 0.44 } }
    ]
  },
  "face-stack": {
    label: "Face + screen",
    description: "Flipped split: camera reaction up top, screen below.",
    previewHint: "Best when the reaction is the star and the screen is supporting context.",
    layers: [
      { kind: "face", fit: "contain", source: streamerCameraSource, dest: { x: 0, y: 0, w: 1, h: 0.44 } },
      { kind: "screen", source: { x: 0, y: 0, w: 1, h: 0.68 }, dest: { x: 0, y: 0.44, w: 1, h: 0.56 } }
    ]
  },
  "screen-focus": {
    label: "Screen lead",
    description: "Clipo-style screen lead with a small face inset.",
    previewHint: "Best when the screen content is the point and the face is supporting context.",
    layers: [
      { kind: "screen", source: { x: 0, y: 0, w: 1, h: 0.72 }, dest: { x: 0, y: 0.08, w: 1, h: 0.78 } },
      { kind: "face", fit: "contain", source: streamerCameraSource, dest: { x: 0.54, y: 0.62, w: 0.4, h: 0.26 } }
    ]
  },
  "face-focus": {
    label: "Face lead",
    description: "Face-first layout with the screen retained as a context banner.",
    previewHint: "Best for reaction, commentary, and talking-head moments from screen-share streams.",
    layers: [
      { kind: "screen", source: { x: 0, y: 0, w: 1, h: 0.68 }, dest: { x: 0.05, y: 0.04, w: 0.9, h: 0.25 } },
      { kind: "face", fit: "contain", source: streamerCameraSource, dest: { x: 0, y: 0.34, w: 1, h: 0.56 } }
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

export function getFaceSource(
  layout: ClipLayoutPreset = DEFAULT_CLIP_LAYOUT,
  overrides?: ClipLayoutOverrides
): Rect {
  const definition = resolveClipLayout(layout, overrides);
  return cloneRect(definition.layers.find((layer) => layer.kind === "face")?.source ?? definition.layers[0]?.source ?? { x: 0, y: 0, w: 1, h: 1 });
}
