import type {
  CaptionSegment,
  CaptionStyle,
  ClipAudio,
  ClipCompositionMode,
  ClipEditSegment,
  ClipExportSettings,
  Overlay,
  RegionRect,
  SfxSettings
} from "@/types/domain";

/**
 * The render-affecting fields of a clip project. Trim, layout, captions,
 * overlays, audio and export settings all change the pixels/audio of the
 * exported file; the title, name and timestamps do not, so they're excluded.
 * Both the server (from the ExportSpec it renders) and the client (from a saved
 * ClipProject) can build this shape, so a signature computed on either side is
 * directly comparable.
 */
export type RenderSignatureInput = {
  baseDurationSec: number;
  trimStart: number;
  trimEnd: number;
  segments?: ClipEditSegment[];
  compositionMode: ClipCompositionMode;
  reframe: { scale: number; offsetX: number; offsetY: number };
  faceSource?: RegionRect;
  screenSource?: RegionRect;
  captions: CaptionSegment[];
  captionStyle: CaptionStyle;
  captionsVisible: boolean;
  highlightCurrentWord: boolean;
  overlays: Overlay[];
  audio: ClipAudio;
  sfx?: SfxSettings;
  settings: ClipExportSettings;
};

/** The effective trim window used by the exporter, so both sides agree on it
 *  even when `trimEnd` is stored as 0 ("use the full duration"). */
export function effectiveTrim(input: {
  baseDurationSec: number;
  trimStart: number;
  trimEnd: number;
}): { start: number; end: number } {
  const base = input.baseDurationSec;
  const start = Math.max(0, Math.min(input.trimStart || 0, base));
  const end = Math.max(start + 0.1, Math.min(input.trimEnd || base, base));
  return { start, end };
}

// A tiny, stable FNV-1a hash so the signature is short and cheap to store on
// the clip and compare on every render. Collisions are astronomically unlikely
// for our purposes (a mismatch only ever means "re-render", never data loss).
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Canonical JSON: object keys are emitted in sorted order at every depth, so the
// signature depends only on the *values*, never on the order the editor's
// reducers or a zod parse happened to build an object in. Without this a clip
// whose nested objects (reframe, captionStyle, an overlay, a caption's words…)
// were rebuilt in a different key order would hash differently and be flagged as
// "needs re-render" forever, even though nothing about the cut changed.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // Drop undefined so an explicit `{ x: undefined }` matches an omitted key,
    // exactly as JSON.stringify already does for object properties.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * A stable fingerprint of everything that changes an export's output. When a
 * clip's rendered `editedFile` carries a signature that no longer matches its
 * saved project, the render is stale and the current trim/edits haven't been
 * baked in yet — so uploading it would post the wrong cut.
 */
export function renderSignature(input: RenderSignatureInput): string {
  const trim = effectiveTrim(input);
  // Fixed key order → identical JSON for identical inputs on both sides.
  const shape = {
    trimStart: Number(trim.start.toFixed(3)),
    trimEnd: Number(trim.end.toFixed(3)),
    segments: input.segments ?? [],
    compositionMode: input.compositionMode,
    reframe: input.reframe,
    faceSource: input.faceSource ?? null,
    screenSource: input.screenSource ?? null,
    captions: input.captions,
    captionStyle: input.captionStyle,
    captionsVisible: input.captionsVisible,
    highlightCurrentWord: input.highlightCurrentWord,
    overlays: input.overlays,
    audio: input.audio,
    sfx: input.sfx ?? null,
    settings: input.settings
  };
  return hash(stableStringify(shape));
}

/**
 * Whether a project carries edits the clip's auto render (the untrimmed
 * `downloadFile`/master) does NOT reflect — i.e. edits that must be rendered
 * before the clip is uploaded. Deliberately narrow: only the edits the auto
 * render can never contain (a real trim, added text/image overlays, a
 * watermark) count here, so a merely-opened clip is never falsely flagged.
 */
export function hasEditsBeyondAutoRender(input: {
  baseDurationSec: number;
  trimStart: number;
  trimEnd: number;
  segments?: ClipEditSegment[];
  overlays: Overlay[];
  settings: ClipExportSettings;
}): boolean {
  const trim = effectiveTrim(input);
  const trimmed = trim.start > 0.05 || trim.end < input.baseDurationSec - 0.05;
  const hasInternalCuts = (input.segments ?? []).some((segment) => !segment.enabled);
  return trimmed || hasInternalCuts || input.overlays.length > 0 || input.settings.watermark === true;
}
