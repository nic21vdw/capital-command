import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CarouselImage } from "@/lib/carousels/imageSlides";
import { saveCarouselImage } from "@/lib/carousels/uploads";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";

/**
 * Stills pulled out of the video a carousel was written from, so the deck shows
 * the moments it is talking about instead of a flat gradient.
 *
 * A still is picked, never simply grabbed: seeking to an even spacing lands on
 * fades, cutaways and mid-blur camera moves as often as not. Each slide gets a
 * handful of candidate frames around its point in the stream, every candidate is
 * scored on exposure, detail and sharpness, and the best one wins — with frames
 * that look like one already chosen pushed down so eight slides aren't eight
 * copies of the same static screen.
 *
 * The scoring half is pure and tested; only `extractVideoFrames` touches ffmpeg
 * and the disk.
 */

/** Size of the grayscale thumbnail every candidate is judged from. */
export const SAMPLE_WIDTH = 64;
export const SAMPLE_HEIGHT = 36;

/** How many frames are examined per slide, and how far apart they sit. */
export const CANDIDATES_PER_SLIDE = 3;
export const CANDIDATE_SPREAD_SEC = 6;

/** Width the chosen frame is stored at — plenty for a 1080-wide slide. */
const STORED_FRAME_WIDTH = 1440;

/** Below this a frame is a fade, a black screen or a blown-out flash. */
const MIN_BRIGHTNESS = 0.07;
const MAX_BRIGHTNESS = 0.94;
/** Below this there is nothing in shot — a solid colour, not a picture. */
const MIN_DETAIL = 0.04;

/** How different two frames must look to count as different moments. */
const DISTINCT_DISTANCE = 0.05;

export type FrameStats = {
  /** Mean luma, 0..1. */
  brightness: number;
  /** Luma spread, 0..1 — a flat frame scores near zero. */
  detail: number;
  /** Edge energy, 0..1 — motion blur and soft focus score low. */
  sharpness: number;
};

/** Reads exposure, contrast and edge energy off a grayscale sample. */
export function frameStats(gray: Uint8Array, width = SAMPLE_WIDTH, height = SAMPLE_HEIGHT): FrameStats {
  if (gray.length < width * height) return { brightness: 0, detail: 0, sharpness: 0 };
  let sum = 0;
  for (let i = 0; i < width * height; i += 1) sum += gray[i];
  const mean = sum / (width * height);
  let variance = 0;
  for (let i = 0; i < width * height; i += 1) variance += (gray[i] - mean) ** 2;
  const stdDev = Math.sqrt(variance / (width * height));

  // Laplacian magnitude over the interior — the standard cheap focus measure.
  let edges = 0;
  let counted = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      edges += Math.abs(value);
      counted += 1;
    }
  }

  return {
    brightness: mean / 255,
    detail: Math.min(1, stdDev / 96),
    sharpness: counted ? Math.min(1, edges / counted / 48) : 0
  };
}

/**
 * How usable a frame is, 0..1. Zero means unusable — a fade to black, a white
 * flash, or a frame with nothing in it — so a slot with only bad candidates
 * ends up with no picture rather than a black one.
 */
export function frameScore(stats: FrameStats): number {
  if (stats.brightness < MIN_BRIGHTNESS || stats.brightness > MAX_BRIGHTNESS) return 0;
  if (stats.detail < MIN_DETAIL) return 0;
  // Well-lit is a band, not a maximum: a bright frame is as wrong as a dark one.
  const exposure = Math.max(0, 1 - Math.abs(stats.brightness - 0.46) / 0.46);
  return exposure * 0.35 + stats.detail * 0.25 + stats.sharpness * 0.4;
}

/** An 8x8 mean-luma signature, used to tell two frames apart. */
export function frameSignature(gray: Uint8Array, width = SAMPLE_WIDTH, height = SAMPLE_HEIGHT): number[] {
  const cells: number[] = [];
  const cellW = Math.max(1, Math.floor(width / 8));
  const cellH = Math.max(1, Math.floor(height / 8));
  for (let cy = 0; cy < 8; cy += 1) {
    for (let cx = 0; cx < 8; cx += 1) {
      let sum = 0;
      let count = 0;
      for (let y = cy * cellH; y < Math.min((cy + 1) * cellH, height); y += 1) {
        for (let x = cx * cellW; x < Math.min((cx + 1) * cellW, width); x += 1) {
          sum += gray[y * width + x] ?? 0;
          count += 1;
        }
      }
      cells.push(count ? sum / count / 255 : 0);
    }
  }
  return cells;
}

/** Mean absolute difference between two signatures, 0..1. */
export function signatureDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (!length) return 1;
  let total = 0;
  for (let i = 0; i < length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / length;
}

/**
 * The point in the video each slide is illustrated from: evenly spread, with the
 * very start and end left out — a stream opens on a title card and ends on a
 * goodbye, and neither is what the slide is about.
 */
export function frameTargets(durationSec: number, count: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || count < 1) return [];
  const start = durationSec * 0.05;
  const end = durationSec * 0.95;
  const span = Math.max(0, end - start);
  return Array.from({ length: count }, (_, index) =>
    Number((start + (span * (index + 0.5)) / count).toFixed(2))
  );
}

/** The candidate seconds examined for one slide, clamped inside the video. */
export function candidateTimes(
  target: number,
  durationSec: number,
  spread = CANDIDATE_SPREAD_SEC,
  perSlide = CANDIDATES_PER_SLIDE
): number[] {
  const offsets = Array.from({ length: perSlide }, (_, index) => (index - (perSlide - 1) / 2) * spread);
  const last = Math.max(0, durationSec - 0.5);
  const times = offsets
    .map((offset) => Number(Math.min(last, Math.max(0, target + offset)).toFixed(2)))
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  return [...new Set(times)];
}

/** A candidate frame, scored and fingerprinted. */
type Candidate = { seconds: number; score: number; signature: number[] };

/**
 * Picks the best candidate for a slot, discounting anything that looks like a
 * frame already used. The discount is a penalty rather than a ban: a stream
 * held on one screen the whole way through still gets pictures, they just stop
 * being preferred once a near-identical one is on the deck.
 */
export function pickCandidate(candidates: Candidate[], used: number[][]): Candidate | null {
  let best: Candidate | null = null;
  let bestValue = 0;
  for (const candidate of candidates) {
    if (candidate.score <= 0) continue;
    const nearest = used.reduce((min, signature) => Math.min(min, signatureDistance(candidate.signature, signature)), 1);
    const value = nearest < DISTINCT_DISTANCE ? candidate.score * 0.35 : candidate.score;
    if (value > bestValue) {
      best = candidate;
      bestValue = value;
    }
  }
  return best;
}

function stamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}m${String(total % 60).padStart(2, "0")}s`;
}

async function sampleFrame(videoPath: string, seconds: number, outPath: string): Promise<Uint8Array | null> {
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT},format=gray`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-y",
      outPath
    ]);
    const data = await readFile(outPath);
    return data.length >= SAMPLE_WIDTH * SAMPLE_HEIGHT ? new Uint8Array(data) : null;
  } catch {
    return null;
  }
}

async function storeFrame(videoPath: string, seconds: number, outPath: string, label: string): Promise<CarouselImage | null> {
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${STORED_FRAME_WIDTH}:-2`,
      "-q:v",
      "3",
      "-y",
      outPath
    ]);
    const bytes = await readFile(outPath);
    if (!bytes.length) return null;
    return await saveCarouselImage(bytes, "image/jpeg", label);
  } catch {
    return null;
  }
}

export type ExtractedFrames = {
  /** Stored stills, in the order the slides should use them. */
  images: CarouselImage[];
  /** Why fewer (or none) came back, for the run's notes. */
  note: string | null;
};

/**
 * Extracts one still per slide from the video, spread across its length and
 * chosen on looks. Never throws: a missing ffmpeg or an unreadable file comes
 * back as an empty set with a note, and the carousel is written without
 * pictures rather than not written at all.
 */
export async function extractVideoFrames(input: {
  videoPath: string;
  durationSec: number;
  count: number;
}): Promise<ExtractedFrames> {
  const targets = frameTargets(input.durationSec, input.count);
  if (!targets.length) return { images: [], note: null };

  let workDir: string;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), "cc-frames-"));
  } catch {
    return { images: [], note: "Could not open a working folder for the video stills." };
  }

  const images: CarouselImage[] = [];
  const used: number[][] = [];
  try {
    for (const [index, target] of targets.entries()) {
      const times = candidateTimes(target, input.durationSec);
      const candidates = (
        await Promise.all(
          times.map(async (seconds, candidateIndex): Promise<Candidate | null> => {
            const gray = await sampleFrame(input.videoPath, seconds, path.join(workDir, `s${index}-${candidateIndex}.gray`));
            if (!gray) return null;
            return { seconds, score: frameScore(frameStats(gray)), signature: frameSignature(gray) };
          })
        )
      ).filter((candidate): candidate is Candidate => Boolean(candidate));

      const pick = pickCandidate(candidates, used);
      if (!pick) continue;
      const stored = await storeFrame(
        input.videoPath,
        pick.seconds,
        path.join(workDir, `s${index}.jpg`),
        `frame-${String(index + 1).padStart(2, "0")}-${stamp(pick.seconds)}.jpg`
      );
      if (!stored) continue;
      images.push(stored);
      used.push(pick.signature);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  if (images.length === 0) {
    return { images, note: "No usable stills could be taken from the video — the slides have no pictures." };
  }
  if (images.length < targets.length) {
    return {
      images,
      note: `Only ${images.length} of ${targets.length} slides got a still from the video.`
    };
  }
  return { images, note: null };
}

/**
 * Stills for a stored clip/long-form source id — what both the Stream Pipeline
 * and the Video Studio use, so a carousel written from a recording looks the
 * same however it was asked for.
 */
export async function framesForSource(sourceId: string, count: number): Promise<ExtractedFrames> {
  const meta = await readSourceMeta(sourceId);
  if (!meta) return { images: [], note: "The video this was written from is no longer on disk." };
  return extractVideoFrames({ videoPath: sourceFilePath(meta), durationSec: meta.durationSec, count });
}
