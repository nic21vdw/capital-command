import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";

// ----- What the stream looks like -----
// The transcript says what was said; it says nothing about what was on
// screen. A passage can read perfectly and still be a blank "starting soon"
// card, a frozen window, or a jump from one app to another halfway through a
// sentence. This is the cheap, always-on half of watching the footage: one
// pass over the stream's keyframes at thumbnail size, which is seconds for a
// multi-hour recording, turned into a timeline of how bright each frame is,
// how much is in it, and how much it changed since the last one.
//
// The vision review (`vision-review.ts`) is the other half: it actually looks
// at the frames of every passage the edit keeps. This scan is what the
// planner, the story pass and the zoom cuts read before any of that is paid
// for, and what they fall back on when no vision model is configured.

const THUMB_W = 64;
const THUMB_H = 36;
const FRAME_BYTES = THUMB_W * THUMB_H;
const CACHE_VERSION = 2;
/** The signature is the thumbnail averaged down to 16x9: enough to tell one shot from another. */
const SIG_W = 16;
const SIG_H = 9;
/** Keyframes further apart than this are too coarse; the scan samples every other second instead. */
const MAX_KEYFRAME_GAP_SEC = 6;

/** A frame whose pixels vary less than this is a solid screen: black, white, a flat card. */
export const BLANK_SPREAD = 8;
/** Mean per-pixel change (0-255) above which two frames are different shots. */
export const SCENE_DIFF = 28;

export type VisualSample = {
  /** Source seconds. */
  t: number;
  /** Mean brightness, 0-255. */
  luma: number;
  /** Standard deviation of brightness: how much is in the frame. */
  spread: number;
  /** Mean absolute change from the previous sample, 0-255. */
  diff: number;
  /** The frame at 16x9, one hex byte per cell, for comparing two moments directly. */
  sig: string;
};

function signature(frame: Uint8Array): string {
  const blockW = THUMB_W / SIG_W;
  const blockH = THUMB_H / SIG_H;
  let out = "";
  for (let row = 0; row < SIG_H; row += 1) {
    for (let col = 0; col < SIG_W; col += 1) {
      let sum = 0;
      for (let y = 0; y < blockH; y += 1) {
        for (let x = 0; x < blockW; x += 1) sum += frame[(row * blockH + y) * THUMB_W + col * blockW + x];
      }
      out += Math.round(sum / (blockW * blockH)).toString(16).padStart(2, "0");
    }
  }
  return out;
}

/** Mean absolute difference between two signatures, 0-255. */
export function signatureDifference(a: string, b: string): number {
  const cells = Math.min(a.length, b.length) / 2;
  if (cells === 0) return 0;
  let diff = 0;
  for (let i = 0; i < cells; i += 1) {
    diff += Math.abs(parseInt(a.slice(i * 2, i * 2 + 2), 16) - parseInt(b.slice(i * 2, i * 2 + 2), 16));
  }
  return diff / cells;
}

/** Turns raw grey thumbnails into samples. Pure, for tests. */
export function samplesFromFrames(frames: Uint8Array[], times: number[]): VisualSample[] {
  const samples: VisualSample[] = [];
  let previous: Uint8Array | null = null;
  frames.forEach((frame, index) => {
    let sum = 0;
    for (const value of frame) sum += value;
    const luma = sum / frame.length;
    let variance = 0;
    for (const value of frame) variance += (value - luma) ** 2;
    let diff = 0;
    if (previous) {
      for (let i = 0; i < frame.length; i += 1) diff += Math.abs(frame[i] - previous[i]);
      diff /= frame.length;
    }
    samples.push({
      t: Math.round((times[index] ?? index) * 1000) / 1000,
      luma: Math.round(luma * 10) / 10,
      spread: Math.round(Math.sqrt(variance / frame.length) * 10) / 10,
      diff: Math.round(diff * 10) / 10,
      sig: frame.length === FRAME_BYTES ? signature(frame) : ""
    });
    previous = frame;
  });
  return samples;
}

function splitFrames(buffer: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset + FRAME_BYTES <= buffer.length; offset += FRAME_BYTES) {
    frames.push(buffer.subarray(offset, offset + FRAME_BYTES));
  }
  return frames;
}

async function extract(srcPath: string, rawPath: string, mode: "keyframes" | "sampled", signal?: AbortSignal) {
  const times: number[] = [];
  const filter =
    mode === "keyframes"
      ? `scale=${THUMB_W}:${THUMB_H},format=gray,showinfo`
      : `fps=0.5,scale=${THUMB_W}:${THUMB_H},format=gray,showinfo`;
  await runFfmpeg(
    [
      "-y",
      "-hide_banner",
      ...(mode === "keyframes" ? ["-skip_frame", "nokey"] : []),
      "-i",
      srcPath,
      "-an",
      "-vf",
      filter,
      "-fps_mode",
      "passthrough",
      "-f",
      "rawvideo",
      rawPath
    ],
    {
      signal,
      onLine: (line) => {
        const match = line.match(/Parsed_showinfo.*pts_time:\s*([0-9.]+)/);
        if (match) times.push(Number(match[1]));
      }
    }
  );
  const frames = splitFrames(new Uint8Array(await readFile(rawPath)));
  return { frames, times };
}

/**
 * The visual timeline of a source, cached beside the project's other work
 * files (never in `projects.json`, which is rewritten on every save).
 */
export async function scanVisualTimeline(input: {
  srcPath: string;
  workDir: string;
  durationSec: number;
  signal?: AbortSignal;
}): Promise<VisualSample[]> {
  const cachePath = path.join(input.workDir, "visual-timeline.json");
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as { version?: number; samples?: VisualSample[] };
    if (cached.version === CACHE_VERSION && Array.isArray(cached.samples) && cached.samples.length > 0) {
      return cached.samples;
    }
  } catch {
    // No cache yet.
  }
  const rawPath = path.join(input.workDir, "visual-timeline.gray");
  try {
    let { frames, times } = await extract(input.srcPath, rawPath, "keyframes", input.signal);
    const averageGap = frames.length > 1 ? input.durationSec / frames.length : Number.POSITIVE_INFINITY;
    if (averageGap > MAX_KEYFRAME_GAP_SEC) {
      ({ frames, times } = await extract(input.srcPath, rawPath, "sampled", input.signal));
    }
    const samples = samplesFromFrames(frames, times);
    await writeFile(cachePath, JSON.stringify({ version: CACHE_VERSION, samples }), "utf8");
    return samples;
  } finally {
    await rm(rawPath, { force: true });
  }
}

/** The cached timeline, or [] when the source was never scanned. Never scans. */
export async function readVisualTimeline(workDir: string): Promise<VisualSample[]> {
  try {
    const cached = JSON.parse(await readFile(path.join(workDir, "visual-timeline.json"), "utf8")) as {
      version?: number;
      samples?: VisualSample[];
    };
    return cached.version === CACHE_VERSION && Array.isArray(cached.samples) ? cached.samples : [];
  } catch {
    return [];
  }
}

// ----- Reading the timeline -----

function inWindow(samples: VisualSample[], start: number, end: number): VisualSample[] {
  return samples.filter((sample) => sample.t >= start && sample.t <= end);
}

export type PassageVisuals = {
  /** How many samples the window holds; 0 means the scan says nothing about it. */
  samples: number;
  /** Share of the window that is a solid screen. */
  blankRatio: number;
  /** Hard changes of shot inside the window (a new app, a new window, a scene switch). */
  shotChanges: number;
  /** Share of the window where nothing on screen moved at all. */
  frozenRatio: number;
};

/** What the screen does across one passage. Pure. */
export function passageVisuals(samples: VisualSample[], start: number, end: number): PassageVisuals {
  const inside = inWindow(samples, start, end);
  if (inside.length === 0) return { samples: 0, blankRatio: 0, shotChanges: 0, frozenRatio: 0 };
  const blank = inside.filter((sample) => sample.spread < BLANK_SPREAD).length;
  const changes = inside.slice(1).filter((sample) => sample.diff > SCENE_DIFF).length;
  const frozen = inside.slice(1).filter((sample) => sample.diff < 0.3).length;
  return {
    samples: inside.length,
    blankRatio: round2(blank / inside.length),
    shotChanges: changes,
    frozenRatio: round2(inside.length > 1 ? frozen / (inside.length - 1) : 0)
  };
}

function nearest(samples: VisualSample[], t: number, side: "before" | "after"): VisualSample | undefined {
  let best: VisualSample | undefined;
  for (const sample of samples) {
    if (side === "before" ? sample.t > t + 0.001 : sample.t < t - 0.001) continue;
    if (!best || Math.abs(sample.t - t) < Math.abs(best.t - t)) best = sample;
  }
  return best;
}

/**
 * How different the picture is either side of a cut from `outSec` to `inSec`,
 * 0-255, or null when the scan has nothing near both edges. Small means the
 * cut joins the same shot (a jump cut, which a zoom cut hides); large means it
 * lands on a different picture (a straight cut is right). Compares the 16x9
 * signatures, and the brightness profile for samples cached without one.
 */
export function cutDifference(samples: VisualSample[], outSec: number, inSec: number): number | null {
  const before = nearest(samples, outSec, "before");
  const after = nearest(samples, inSec, "after");
  if (!before || !after) return null;
  if (Math.abs(before.t - outSec) > 8 || Math.abs(after.t - inSec) > 8) return null;
  if (Math.abs(inSec - outSec) < 0.001) return 0;
  if (before.sig && after.sig) return round2(signatureDifference(before.sig, after.sig));
  // Without a signature, the brightness and content level either side is the
  // honest proxy: the same shot keeps both, a new one changes one or both.
  return round2(Math.abs(before.luma - after.luma) + Math.abs(before.spread - after.spread));
}

/** A one-line description of a passage's screen for the story pass, or "" when there is nothing to say. */
export function visualHint(visuals: PassageVisuals): string {
  if (visuals.samples === 0) return "";
  const notes: string[] = [];
  if (visuals.blankRatio >= 0.3) notes.push(`screen blank ${Math.round(visuals.blankRatio * 100)}%`);
  if (visuals.frozenRatio >= 0.9) notes.push("screen static");
  if (visuals.shotChanges >= 4) notes.push(`${visuals.shotChanges} screen switches`);
  return notes.join(", ");
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
