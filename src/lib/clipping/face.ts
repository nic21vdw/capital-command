import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { cropWindow, type ClipFraming, type FramingTarget } from "@/lib/clipping/framing";

/**
 * Finds the speaker by their FACE, with the same YuNet detector the story edit
 * uses, before the dependency-free skin-and-motion detector in `subject.ts` is
 * tried. On the basement camera that detector often finds nothing (a warm-lit
 * room reads as skin from wall to wall), and the clip then shipped as a thin
 * strip over blur. A real face detector finds the face in every camera frame.
 *
 * Fails open: no Python, no OpenCV or no model file returns null and the
 * caller carries on exactly as before.
 */

export type FaceBox = { x: number; y: number; w: number; h: number; score: number };
export type FaceFrame = { t: number; faces: FaceBox[] };
export type FaceSample = { t: number; cx: number; cy: number; w: number; h: number };
export type FaceTrack = { samples: FaceSample[]; presence: number; w: number; h: number; cx: number; cy: number };

const MIN_SCORE = 0.75;
const SAME_FACE_X = 0.12;
const SAME_FACE_Y = 0.18;
/** The speaker has to be on screen this share of the clip to frame on them. */
export const MIN_FACE_PRESENCE = 0.35;
/** A face shorter than this share of the frame is a camera overlay on a screenshare. */
export const OVERLAY_FACE_H = 0.1;
/** Share of the crop height the face takes; a 0.3 face gives a full-height crop. */
const FACE_FILL = 0.3;
/** Where the face centre sits inside the crop, top-down: eyes in the upper third. */
const FACE_ANCHOR = 0.38;
/**
 * The crop holds still until the face drifts this share of the crop width from
 * where it was framed, then moves once over {@link REFRAME_SEC}. A seated
 * streamer leaning and gesturing should not make the shot swim.
 */
const REFRAME_SHARE = 0.18;
const REFRAME_SEC = 0.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function centre(face: FaceBox) {
  return { cx: face.x + face.w / 2, cy: face.y + face.h / 2 };
}

function near(a: { cx: number; cy: number }, b: { cx: number; cy: number }, scale = 1) {
  return Math.abs(a.cx - b.cx) < SAME_FACE_X * scale && Math.abs(a.cy - b.cy) < SAME_FACE_Y * scale;
}

/**
 * Picks the face that stays put across the clip: the streamer, not a face that
 * flashes past in a video on the screen. Returns null when no face is on screen
 * for at least {@link MIN_FACE_PRESENCE} of the frames.
 */
export function pickSpeakerFace(frames: FaceFrame[]): FaceTrack | null {
  if (!frames.length) return null;
  const confident = frames.map((frame) => frame.faces.filter((face) => face.score >= MIN_SCORE));
  let anchor: { cx: number; cy: number } | null = null;
  let bestCount = 0;
  let bestArea = 0;
  for (const faces of confident) {
    for (const face of faces) {
      const point = centre(face);
      const count = confident.filter((others) => others.some((other) => near(centre(other), point))).length;
      const area = face.w * face.h;
      if (count > bestCount || (count === bestCount && area > bestArea)) {
        anchor = point;
        bestCount = count;
        bestArea = area;
      }
    }
  }
  if (!anchor || bestCount / frames.length < MIN_FACE_PRESENCE) return null;

  const found: Array<FaceBox | null> = confident.map((faces) => {
    let best: FaceBox | null = null;
    let bestDistance = Infinity;
    for (const face of faces) {
      const point = centre(face);
      if (!near(point, anchor as { cx: number; cy: number }, 2)) continue;
      const distance = Math.hypot(point.cx - (anchor as { cx: number }).cx, point.cy - (anchor as { cy: number }).cy);
      if (distance < bestDistance) {
        best = face;
        bestDistance = distance;
      }
    }
    return best;
  });
  const seen = found.filter((face): face is FaceBox => face !== null);
  const w = median(seen.map((face) => face.w));
  const h = median(seen.map((face) => face.h));

  const samples: FaceSample[] = [];
  let last = { cx: median(seen.map((face) => centre(face).cx)), cy: median(seen.map((face) => centre(face).cy)) };
  frames.forEach((frame, index) => {
    const face = found[index];
    if (face) last = centre(face);
    samples.push({ t: frame.t, cx: last.cx, cy: last.cy, w, h });
  });
  const smoothed = samples.map((sample, index) => {
    const window = samples.slice(Math.max(0, index - 2), index + 3);
    return { ...sample, cx: median(window.map((s) => s.cx)), cy: median(window.map((s) => s.cy)) };
  });
  return {
    samples: smoothed,
    presence: bestCount / frames.length,
    w,
    h,
    cx: median(smoothed.map((s) => s.cx)),
    cy: median(smoothed.map((s) => s.cy))
  };
}

export function holdThenMove(points: Array<{ t: number; x: number; y: number }>, threshold: number) {
  if (!points.length) return [];
  const held = [points[0]];
  let current = points[0];
  for (const point of points.slice(1)) {
    if (Math.abs(point.x - current.x) <= threshold && Math.abs(point.y - current.y) <= threshold) continue;
    const startAt = Math.max(held[held.length - 1].t, point.t - REFRAME_SEC);
    if (startAt > held[held.length - 1].t) held.push({ ...current, t: startAt });
    held.push(point);
    current = point;
  }
  const last = points[points.length - 1];
  if (held[held.length - 1].t < last.t) held.push({ ...current, t: last.t });
  return held;
}

/** Turns a face track into a framing, or null when there is no face to frame on. */
export function planFaceFraming(track: FaceTrack | null, target: FramingTarget): ClipFraming | null {
  if (!track || track.presence < MIN_FACE_PRESENCE || track.h <= 0) return null;
  const confidence = Number(track.presence.toFixed(3));

  if (track.h < OVERLAY_FACE_H) {
    const w = clamp(track.w * 2.6, 0.12, 1);
    const h = clamp(track.h * 2.2, 0.12, 1);
    return {
      mode: "speaker-stack",
      faceSource: { x: clamp(track.cx - w / 2, 0, 1 - w), y: clamp(track.cy - h / 2, 0, 1 - h), w, h },
      confidence,
      reason: "Found the face in a camera overlay; led with it, screen kept as context."
    };
  }

  const crop = cropWindow(track.h, target, FACE_FILL);
  const position = (cx: number, cy: number, t: number) => ({
    t,
    x: clamp(cx - crop.w / 2, 0, 1 - crop.w),
    y: clamp(cy - crop.h * FACE_ANCHOR, 0, 1 - crop.h)
  });
  const keyframes = holdThenMove(track.samples.map((s) => position(s.cx, s.cy, s.t)), crop.w * REFRAME_SHARE);
  return {
    mode: "subject-fill",
    crop,
    keyframes,
    confidence,
    reason: "Framed full-bleed on the speaker's face."
  };
}

export function faceModelPath(): string {
  return process.env.CLIP_FACE_MODEL?.trim() || path.join(process.cwd(), "data", "clips", "bin", "face_detection_yunet_2023mar.onnx");
}

function pythonBinary(): string {
  return process.env.CLIP_PYTHON?.trim() || process.env.STORY_PYTHON?.trim() || "python";
}

/** Runs the face detector over a cut section. Null when it cannot run. */
export async function detectFaceFrames(inputPath: string, maxSeconds = 180): Promise<FaceFrame[] | null> {
  if ((process.env.CLIP_FACE_FRAMING ?? "").trim().toLowerCase() === "off") return null;
  const model = faceModelPath();
  if (!existsSync(model)) return null;
  const script = path.join(process.cwd(), "scripts", "clips", "face_track.py");
  return new Promise((resolve) => {
    execFile(
      pythonBinary(),
      [script, inputPath, "--model", model, "--max-seconds", String(maxSeconds)],
      { maxBuffer: 32 * 1024 * 1024, timeout: 180_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const parsed = JSON.parse(String(stdout)) as { frames?: FaceFrame[] };
          resolve(Array.isArray(parsed.frames) ? parsed.frames : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}
