import { centerBlurVideoTopFrac, DEFAULT_CENTER_BLUR_ZOOM } from "@/lib/clipping/centerBlur";
import { coverScale } from "@/lib/clipping/encode";
import type { Rect } from "@/lib/clipping/layouts";
import type { SubjectTrack } from "@/lib/clipping/subject";

/**
 * Decides how a clip should be composed into a vertical frame once the speaker
 * has been located, and builds the ffmpeg geometry for that decision.
 *
 * The old answer was always the same: shrink the whole widescreen frame into
 * the middle of a 9:16 canvas and blur the rest. That reads as a downscaled
 * desktop recording. These modes instead give the frame to whoever is talking:
 *
 * - `subject-fill` — crop a 9:16 window around the speaker and let it fill the
 *   whole frame, panning with them. Nothing is blurred, nothing is letterboxed.
 * - `speaker-stack` — for a screenshare with a small camera overlay: lead with
 *   the DETECTED camera region rather than the hardcoded corner guess, and keep
 *   the screen as a banner.
 * - `center-blur` — the neutral fallback, used only when no speaker was found.
 */

export type ClipFramingMode = "subject-fill" | "speaker-stack" | "center-blur";

/** Crop-window top-left at a point in time, normalized to the source frame. */
export type FramingKeyframe = { t: number; x: number; y: number };

export type ClipFraming = {
  mode: ClipFramingMode;
  /** Crop window size, normalized to the source frame (`subject-fill`). */
  crop?: { w: number; h: number };
  keyframes?: FramingKeyframe[];
  /** Detected camera region, normalized to the source frame (`speaker-stack`). */
  faceSource?: Rect;
  confidence: number;
  reason: string;
};

export type FramingTarget = {
  sourceW: number;
  sourceH: number;
  targetW: number;
  targetH: number;
};

/** Below this the detection is guesswork, and a guess is worse than neutral. */
export const MIN_FRAMING_CONFIDENCE = 0.32;
/** A subject smaller than this is a camera overlay on a screenshare, not a shot. */
export const OVERLAY_AREA = 0.06;
/**
 * How far the source may be blown up to fill the frame. A 9:16 window of a
 * 1080p landscape recording is already a 1.78x upscale at full height, so a
 * limit below that would forbid punching in at all on the most common source
 * this app sees; 2.4x is as soft as a face on a phone screen can be.
 */
const MAX_UPSCALE = 2.4;
/** Fraction of the crop height the subject should occupy. */
const SUBJECT_FILL = 0.46;
/**
 * Where the subject's centre of mass sits inside the crop, top-down. Below the
 * middle, because detection centres on the face and a head framed dead-centre
 * has its hair cut off by the top edge.
 */
const SUBJECT_ANCHOR = 0.56;
const MAX_KEYFRAMES = 12;
/** The layout `speaker-stack` renders through, and where its camera slot starts. */
export const SPEAKER_STACK_LAYOUT = "face-focus" as const;
const SPEAKER_STACK_FACE_TOP = 0.36;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function neutral(confidence: number, reason: string): ClipFraming {
  return { mode: "center-blur", confidence, reason };
}

/**
 * Sizes the crop window so the subject fills a natural share of the frame,
 * without ever upscaling the source past {@link MAX_UPSCALE} or asking for a
 * window bigger than the source.
 */
function cropWindow(subjectH: number, target: FramingTarget): { w: number; h: number } {
  const aspect = target.targetW / target.targetH;
  const minH = Math.max(0.3, (target.targetH / MAX_UPSCALE) / target.sourceH);
  let h = clamp(subjectH / SUBJECT_FILL, Math.min(1, minH), 1);
  let w = (h * target.sourceH * aspect) / target.sourceW;
  if (w > 1) {
    w = 1;
    h = clamp(target.sourceW / aspect / target.sourceH, 0.05, 1);
  }
  return { w, h };
}

/** Drops keyframes that barely move, so the pan is a glide and not a jitter. */
function thinKeyframes(keyframes: FramingKeyframe[]): FramingKeyframe[] {
  if (keyframes.length <= 1) return keyframes;
  const kept: FramingKeyframe[] = [keyframes[0]];
  for (const frame of keyframes.slice(1)) {
    const last = kept[kept.length - 1];
    if (Math.abs(frame.x - last.x) > 0.015 || Math.abs(frame.y - last.y) > 0.02) kept.push(frame);
  }
  const final = keyframes[keyframes.length - 1];
  if (kept[kept.length - 1].t !== final.t) kept.push(final);
  if (kept.length <= MAX_KEYFRAMES) return kept;
  const step = (kept.length - 1) / (MAX_KEYFRAMES - 1);
  const thinned: FramingKeyframe[] = [];
  for (let i = 0; i < MAX_KEYFRAMES; i += 1) thinned.push(kept[Math.round(i * step)]);
  return thinned;
}

export function planFraming(track: SubjectTrack | null, target: FramingTarget): ClipFraming {
  if (!track || !track.samples.length) return neutral(0, "No speaker was detected in this clip.");
  if (track.confidence < MIN_FRAMING_CONFIDENCE) {
    return neutral(track.confidence, "The speaker could not be located confidently.");
  }

  const medW = median(track.samples.map((s) => s.w));
  const medH = median(track.samples.map((s) => s.h));
  const medX = median(track.samples.map((s) => s.cx));
  const medY = median(track.samples.map((s) => s.cy));

  if (track.area < OVERLAY_AREA) {
    // A small, stable region on a much larger frame: a camera overlay. Pad it
    // out so the crop holds the whole head rather than clipping its edges.
    const w = clamp(medW * 2.1, 0.12, 1);
    const h = clamp(medH * 1.9, 0.12, 1);
    return {
      mode: "speaker-stack",
      faceSource: {
        x: clamp(medX - w / 2, 0, 1 - w),
        y: clamp(medY - h / 2, 0, 1 - h),
        w,
        h
      },
      confidence: track.confidence,
      reason: "Led with the camera where the speaker actually is, screen kept as context."
    };
  }

  const crop = cropWindow(medH, target);
  const keyframes = track.samples.map((sample) => ({
    t: sample.t,
    x: clamp(sample.cx - crop.w / 2, 0, 1 - crop.w),
    y: clamp(sample.cy - crop.h * SUBJECT_ANCHOR, 0, 1 - crop.h)
  }));

  return {
    mode: "subject-fill",
    crop,
    keyframes: thinKeyframes(keyframes),
    confidence: track.confidence,
    reason: "Framed full-bleed on the speaker, tracking them across the clip."
  };
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Builds a piecewise-linear ffmpeg expression over `t` from keyframes.
 *
 * Only crop's `x`/`y` may vary with time — its `w`/`h` are evaluated once at
 * graph-config time, where `t` is NaN, so the window SIZE is fixed for the
 * whole clip and only its position moves.
 */
export function keyframeExpression(points: Array<{ t: number; v: number }>): string {
  if (!points.length) return "0";
  if (points.length === 1) return String(Math.round(points[0].v));
  let expression = String(Math.round(points[points.length - 1].v));
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const from = points[i];
    const to = points[i + 1];
    const span = Math.max(0.05, to.t - from.t);
    const ramp = `${Math.round(from.v)}+(${Math.round(to.v - from.v)})*(t-${from.t.toFixed(2)})/${span.toFixed(2)}`;
    expression = `if(lt(t,${to.t.toFixed(2)}),${ramp},${expression})`;
  }
  return expression;
}

/**
 * The filter chain for a `subject-fill` framing: crop the tracked window out of
 * the source and scale it to fill the whole output frame. The crop is exactly
 * the output aspect, so there is nothing to letterbox and no blur behind it.
 */
export function subjectFillChain(
  framing: ClipFraming,
  target: FramingTarget,
  inLabel = "0:v",
  outLabel = "vc"
): string {
  const crop = framing.crop ?? { w: 1, h: 1 };
  const cropW = even(clamp(crop.w, 0.05, 1) * target.sourceW);
  const cropH = even(clamp(crop.h, 0.05, 1) * target.sourceH);
  const maxX = Math.max(0, target.sourceW - cropW);
  const maxY = Math.max(0, target.sourceH - cropH);
  const keyframes = framing.keyframes?.length ? framing.keyframes : [{ t: 0, x: 0.5 - crop.w / 2, y: 0.5 - crop.h / 2 }];
  const x = keyframeExpression(keyframes.map((k) => ({ t: k.t, v: clamp(k.x * target.sourceW, 0, maxX) })));
  const y = keyframeExpression(keyframes.map((k) => ({ t: k.t, v: clamp(k.y * target.sourceH, 0, maxY) })));
  return (
    `[${inLabel}]crop=${cropW}:${cropH}:x='${x}':y='${y}',` +
    `${coverScale(target.targetW, target.targetH)},` +
    `crop=${target.targetW}:${target.targetH},setsar=1[${outLabel}]`
  );
}

/**
 * Expresses a `subject-fill` framing as the editor's crop-fill transform, so
 * the Clip Editor can auto-frame a project with the controls (and the live
 * preview) it already has. The editor's crop is static, so the middle of the
 * tracked pan is used.
 *
 * Crop-fill scales the source to COVER the output, scales it again by `scale`,
 * then takes a centered window nudged by `offsetX`/`offsetY` across whatever
 * space is spare — so the visible fraction of the source is `1/(cover*scale)`
 * and an offset of ±1 pins the window to an edge.
 */
export function framingToReframe(
  framing: ClipFraming,
  target: FramingTarget
): { scale: number; offsetX: number; offsetY: number } | null {
  if (framing.mode !== "subject-fill" || !framing.crop) return null;
  const cover = Math.max(target.targetW / target.sourceW, target.targetH / target.sourceH);
  const scale = clamp(target.targetW / (target.sourceW * cover * framing.crop.w), 1, 8);
  const visibleX = target.targetW / (target.sourceW * cover * scale);
  const visibleY = target.targetH / (target.sourceH * cover * scale);
  const keyframes = framing.keyframes ?? [];
  const x = keyframes.length ? median(keyframes.map((k) => k.x)) : (1 - visibleX) / 2;
  const y = keyframes.length ? median(keyframes.map((k) => k.y)) : (1 - visibleY) / 2;
  const offset = (position: number, visible: number) =>
    visible >= 0.999 ? 0 : clamp((2 * position) / (1 - visible) - 1, -1, 1);
  return { scale, offsetX: offset(x, visibleX), offsetY: offset(y, visibleY) };
}

/**
 * Where the visible video starts, top-down, so the burned title clears it.
 *
 * `zoom` is the center + blur punch-in, which grows the video band and so moves
 * the title up with it; it is ignored by the modes that fill the frame.
 */
export function framingVideoTopFrac(
  framing: ClipFraming,
  target: FramingTarget,
  zoom: number = DEFAULT_CENTER_BLUR_ZOOM
): number {
  if (framing.mode === "subject-fill") return 0;
  // Face-lead puts the screen banner at the top and the camera below it — the
  // title belongs in the gap between them, not over either.
  if (framing.mode === "speaker-stack") return SPEAKER_STACK_FACE_TOP;
  return centerBlurVideoTopFrac(
    { width: target.sourceW, height: target.sourceH },
    { width: target.targetW, height: target.targetH },
    zoom
  );
}
