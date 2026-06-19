import type {
  AspectPreset,
  AspectRatio,
  CameraOverlay,
  ClipFraming,
  VideoClip,
  VideoProject,
  VideoSource
} from "@/types/domain";

export type AspectOption = { preset: AspectPreset; label: string; hint: string; w: number; h: number };

export const ASPECT_PRESETS: AspectOption[] = [
  { preset: "9:16", label: "YouTube Short", hint: "9:16", w: 9, h: 16 },
  { preset: "16:9", label: "YouTube Video", hint: "16:9", w: 16, h: 9 },
  { preset: "1:1", label: "Square Social", hint: "1:1", w: 1, h: 1 },
  { preset: "4:5", label: "Portrait Social", hint: "4:5", w: 4, h: 5 },
  { preset: "custom", label: "Custom", hint: "Any", w: 9, h: 16 }
];

export type ExportOption = { id: string; label: string; width: number; height: number; aspect: AspectPreset };

export const EXPORT_PRESETS: ExportOption[] = [
  { id: "short-1080x1920", label: "Short · 1080×1920", width: 1080, height: 1920, aspect: "9:16" },
  { id: "video-1920x1080", label: "Video · 1920×1080", width: 1920, height: 1080, aspect: "16:9" },
  { id: "video-2560x1440", label: "Video · 2560×1440", width: 2560, height: 1440, aspect: "16:9" },
  { id: "square-1080", label: "Square · 1080×1080", width: 1080, height: 1080, aspect: "1:1" },
  { id: "portrait-1080x1350", label: "Portrait · 1080×1350", width: 1080, height: 1350, aspect: "4:5" }
];

/** Stable key for the per-aspect framing map (`${w}:${h}`). */
export function aspectKey(aspect: AspectRatio): string {
  return `${aspect.w}:${aspect.h}`;
}

export function defaultFraming(mode: ClipFraming["mode"] = "fill"): ClipFraming {
  return {
    mode,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    srcRect: { x: 0, y: 0, w: 1, h: 1 }
  };
}

export function getFraming(clip: VideoClip, aspect: AspectRatio): ClipFraming {
  return clip.framing[aspectKey(aspect)] ?? defaultFraming();
}

export function withFraming(clip: VideoClip, aspect: AspectRatio, framing: ClipFraming): VideoClip {
  return { ...clip, framing: { ...clip.framing, [aspectKey(aspect)]: framing } };
}

// --- Livestream layout presets -------------------------------------------
// Each preset reframes the *same* source for vertical output of footage that
// contains both a webcam and the Nic Vandewetering interface.

export type LayoutPreset = {
  id: string;
  label: string;
  description: string;
  apply: (clip: VideoClip, aspect: AspectRatio) => VideoClip;
};

function setPrimary(clip: VideoClip, aspect: AspectRatio, patch: Partial<ClipFraming>): VideoClip {
  return withFraming(clip, aspect, { ...getFraming(clip, aspect), ...patch });
}

function disableCamera(clip: VideoClip): VideoClip {
  return { ...clip, camera: { ...clip.camera, enabled: false } };
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "none",
    label: "Reset",
    description: "Cover-fill, no overlay.",
    apply: (clip, aspect) =>
      disableCamera(setPrimary({ ...clip, layoutPreset: "none" }, aspect, { ...defaultFraming("fill") }))
  },
  {
    id: "full-frame",
    label: "Full-frame crop",
    description: "Source fills the frame, centred.",
    apply: (clip, aspect) =>
      disableCamera(
        setPrimary({ ...clip, layoutPreset: "full-frame" }, aspect, {
          mode: "fill",
          x: 0,
          y: 0,
          scale: 1,
          srcRect: { x: 0, y: 0, w: 1, h: 1 }
        })
      )
  },
  {
    id: "screen-focus",
    label: "Screen-focused crop",
    description: "Zooms into the interface area.",
    apply: (clip, aspect) =>
      disableCamera(
        setPrimary({ ...clip, layoutPreset: "screen-focus" }, aspect, {
          mode: "crop",
          x: 0,
          y: 0,
          scale: 1,
          srcRect: { x: 0.18, y: 0.08, w: 0.64, h: 0.84 }
        })
      )
  },
  {
    id: "camera-focus",
    label: "Camera-focused crop",
    description: "Zooms into the webcam corner.",
    apply: (clip, aspect) =>
      disableCamera(
        setPrimary({ ...clip, layoutPreset: "camera-focus" }, aspect, {
          mode: "crop",
          x: 0,
          y: 0,
          scale: 1,
          srcRect: { x: 0.66, y: 0.0, w: 0.34, h: 0.34 }
        })
      )
  },
  {
    id: "blurred-fill",
    label: "Blurred background",
    description: "Fits the source over a blurred fill.",
    apply: (clip, aspect) =>
      disableCamera({
        ...setPrimary({ ...clip, layoutPreset: "blurred-fill" }, aspect, {
          ...defaultFraming("fit")
        }),
        background: { type: "blur", color: "#000000" }
      })
  },
  {
    id: "camera-top",
    label: "Camera above screen",
    description: "Webcam band on top, screen below.",
    apply: (clip, aspect) => ({
      ...setPrimary({ ...clip, layoutPreset: "camera-top" }, aspect, {
        mode: "crop",
        x: 0,
        y: 0,
        scale: 1,
        srcRect: { x: 0.15, y: 0.06, w: 0.7, h: 0.9 }
      }),
      camera: {
        enabled: true,
        srcRect: { x: 0.66, y: 0, w: 0.34, h: 0.34 },
        destRect: { x: 0, y: 0, w: 1, h: 0.32 },
        radius: 0
      }
    })
  },
  {
    id: "camera-bottom",
    label: "Camera below screen",
    description: "Screen on top, webcam band below.",
    apply: (clip, aspect) => ({
      ...setPrimary({ ...clip, layoutPreset: "camera-bottom" }, aspect, {
        mode: "crop",
        x: 0,
        y: 0,
        scale: 1,
        srcRect: { x: 0.15, y: 0.06, w: 0.7, h: 0.9 }
      }),
      camera: {
        enabled: true,
        srcRect: { x: 0.66, y: 0, w: 0.34, h: 0.34 },
        destRect: { x: 0, y: 0.68, w: 1, h: 0.32 },
        radius: 0
      }
    })
  },
  {
    id: "side-by-side",
    label: "Side-by-side",
    description: "Screen left, webcam right.",
    apply: (clip, aspect) => ({
      ...setPrimary({ ...clip, layoutPreset: "side-by-side" }, aspect, {
        mode: "crop",
        x: 0,
        y: 0,
        scale: 1,
        srcRect: { x: 0.1, y: 0.2, w: 0.55, h: 0.6 }
      }),
      camera: {
        enabled: true,
        srcRect: { x: 0.66, y: 0, w: 0.34, h: 0.34 },
        destRect: { x: 0.5, y: 0.3, w: 0.5, h: 0.4 },
        radius: 0
      }
    })
  }
];

// --- Factories ------------------------------------------------------------

export function makeClip(input?: Partial<VideoClip>): VideoClip {
  const camera: CameraOverlay = input?.camera ?? {
    enabled: false,
    srcRect: { x: 0.7, y: 0, w: 0.3, h: 0.3 },
    destRect: { x: 0, y: 0, w: 1, h: 0.35 },
    radius: 0
  };
  return {
    id: input?.id ?? `clip-${crypto.randomUUID().slice(0, 8)}`,
    sourceStart: input?.sourceStart ?? 0,
    sourceEnd: input?.sourceEnd ?? 0,
    volume: input?.volume ?? 1,
    muted: input?.muted ?? false,
    speed: input?.speed ?? 1,
    fadeIn: input?.fadeIn ?? 0,
    fadeOut: input?.fadeOut ?? 0,
    background: input?.background ?? { type: "blur", color: "#000000" },
    layoutPreset: input?.layoutPreset ?? "none",
    camera,
    framing: input?.framing ?? {}
  };
}

export function makeProject(input?: Partial<VideoProject>): VideoProject {
  const now = new Date().toISOString();
  return {
    id: input?.id ?? `vproj-${crypto.randomUUID().slice(0, 8)}`,
    name: input?.name ?? "Untitled project",
    source: input?.source ?? null,
    aspect: input?.aspect ?? { preset: "9:16", w: 9, h: 16 },
    exportPreset: input?.exportPreset ?? "short-1080x1920",
    clips: input?.clips ?? [],
    createdAt: input?.createdAt ?? now,
    updatedAt: input?.updatedAt ?? now
  };
}

export function sourceFromMeta(meta: {
  id: string;
  fileName: string;
  mime: string;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
}): VideoSource {
  return {
    id: meta.id,
    kind: "upload",
    fileName: meta.fileName,
    mime: meta.mime,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    hasAudio: meta.hasAudio,
    sizeBytes: meta.sizeBytes
  };
}

export function streamUrl(source: VideoSource | null): string | null {
  if (!source) return null;
  if (source.kind === "url" && source.url) return source.url;
  return `/api/clips/sources/${source.id}/stream`;
}

export function waveformUrl(source: VideoSource | null): string | null {
  if (!source || source.kind !== "upload") return null;
  return `/api/clips/sources/${source.id}/waveform`;
}

// --- Timeline math --------------------------------------------------------

export function clipDuration(clip: VideoClip): number {
  return Math.max(0, (clip.sourceEnd - clip.sourceStart) / Math.max(0.05, clip.speed));
}

export type TimelineSegments = { starts: number[]; total: number };

export function computeSegments(clips: VideoClip[]): TimelineSegments {
  const starts: number[] = [];
  let acc = 0;
  for (const clip of clips) {
    starts.push(acc);
    acc += clipDuration(clip);
  }
  return { starts, total: acc };
}

export function locateTime(clips: VideoClip[], segments: TimelineSegments, t: number) {
  if (clips.length === 0) return null;
  const clamped = Math.max(0, Math.min(t, segments.total));
  let index = 0;
  for (let i = clips.length - 1; i >= 0; i--) {
    if (clamped >= segments.starts[i]) {
      index = i;
      break;
    }
  }
  const clip = clips[index];
  const localTime = clamped - segments.starts[index];
  const sourceTime = clip.sourceStart + localTime * clip.speed;
  return { index, clip, localTime, sourceTime };
}

// --- Timecode formatting --------------------------------------------------

export function formatTimecode(seconds: number, withMs = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  if (!withMs) return base;
  const ms = Math.floor((seconds % 1) * 100);
  return `${base}.${String(ms).padStart(2, "0")}`;
}

/** Parse "h:mm:ss.ms", "m:ss", or plain seconds into seconds (or null). */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds;
}

// --- Framing → CSS transform ----------------------------------------------

export type LayerStyle = { tx: number; ty: number; scale: number; videoW: number; videoH: number };

/**
 * Maps a source sub-rectangle into a destination box (frameW × frameH px) and
 * returns the absolute size + translate/scale to apply to a <video> rendered at
 * its intrinsic pixel size with transform-origin 0 0.
 */
export function computeLayerStyle(
  frameW: number,
  frameH: number,
  srcW: number,
  srcH: number,
  framing: { mode: ClipFraming["mode"]; x: number; y: number; scale: number; srcRect: ClipFraming["srcRect"] }
): LayerStyle {
  const sw = srcW > 0 ? srcW : 1920;
  const sh = srcH > 0 ? srcH : 1080;
  const rect = framing.srcRect;
  const subW = sw * rect.w;
  const subH = sh * rect.h;
  const coverBase = Math.max(frameW / subW, frameH / subH);
  const fitBase = Math.min(frameW / subW, frameH / subH);
  const base = framing.mode === "fit" ? fitBase : coverBase;
  const scale = base * framing.scale;

  // Source-pixel centre of the sub-rect we want to land at frame centre.
  const cx = (rect.x + rect.w / 2) * sw;
  const cy = (rect.y + rect.h / 2) * sh;

  const panX = framing.x * frameW;
  const panY = framing.y * frameH;

  const tx = frameW / 2 + panX - scale * cx;
  const ty = frameH / 2 + panY - scale * cy;

  return { tx, ty, scale, videoW: sw, videoH: sh };
}

/** Fade-aware volume multiplier (0..1) for a given source time within a clip. */
export function fadeMultiplier(clip: VideoClip, sourceTime: number): number {
  let mult = 1;
  const inEnd = clip.sourceStart + clip.fadeIn;
  if (clip.fadeIn > 0 && sourceTime < inEnd) {
    mult *= Math.max(0, (sourceTime - clip.sourceStart) / clip.fadeIn);
  }
  const outStart = clip.sourceEnd - clip.fadeOut;
  if (clip.fadeOut > 0 && sourceTime > outStart) {
    mult *= Math.max(0, (clip.sourceEnd - sourceTime) / clip.fadeOut);
  }
  return Math.max(0, Math.min(1, mult));
}
