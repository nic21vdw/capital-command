import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { anchorSlides, type SlideAnchor, type TranscriptSegment } from "@/lib/carousels/anchors";
import { frameRelevanceConfigured, MIN_FRAME_RELEVANCE, rateFrame, RATED_CANDIDATES } from "@/lib/carousels/relevance";
import type { CarouselImage } from "@/lib/carousels/imageSlides";
import { saveCarouselImage } from "@/lib/carousels/uploads";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";

/**
 * Stills pulled out of the video a carousel was written from, so the deck shows
 * the moments it is talking about instead of a flat gradient.
 *
 * WHICH moment a slide is illustrated from is decided in anchors.ts, off the
 * words that slide was written from. This module only picks the best frame near
 * that moment: seeking to an exact second lands on fades, cutaways and mid-blur
 * camera moves as often as not, so a handful of candidates around it are scored
 * on exposure, detail and sharpness and the best one wins — with frames that
 * look like one already chosen pushed down so eight slides aren't eight copies
 * of the same static screen.
 *
 * The scoring half is pure and tested; only `extractVideoFrames` touches ffmpeg
 * and the disk.
 */

/** Size of the grayscale thumbnail every candidate is judged from. */
export const SAMPLE_WIDTH = 64;
export const SAMPLE_HEIGHT = 36;

/**
 * How many frames are examined per slide, and how far apart they sit.
 *
 * The window is deliberately SHORT and finely sampled. What is on a
 * screen-share changes in seconds — a slide anchored to the moment a terminal
 * was in use scored 9 with a five-second window and 2 with a twenty-second one,
 * because ten seconds earlier he was in a browser. The candidates exist to step
 * over a blink, a hand swept past the lens or a fade, not to go looking for a
 * nicer picture somewhere else, and stepping over those needs closely spaced
 * frames rather than distant ones.
 */
export const CANDIDATES_PER_SLIDE = 9;
export const CANDIDATE_SPREAD_SEC = 0.7;

/**
 * How much a candidate is discounted per second away from the anchor. A frame
 * two seconds off has to be clearly better to win; one five seconds off nearly
 * always loses, which is the point.
 */
const DRIFT_PENALTY_PER_SEC = 0.09;

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
  // Sharpness dominates, because the frames this has to reject are all soft:
  // a hand swept past the lens, a head turning, a blink caught mid-way. Those
  // still have plenty of contrast, so detail alone would happily pick them.
  return exposure * 0.25 + stats.detail * 0.15 + stats.sharpness * 0.6;
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

export { spreadTargets as frameTargets } from "@/lib/carousels/anchors";

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
export type Candidate = { seconds: number; score: number; signature: number[] };

/**
 * Picks the best candidate for a slot: closest to the moment the slide is
 * about, unless the frames there are unusable.
 *
 * Two discounts, both penalties rather than bans. Distance from the anchor,
 * because a few seconds on a screen-share is a different application and the
 * anchor is the only thing tying the picture to the words. And looking like a
 * frame already used, so a stream held on one screen still gets pictures — they
 * just stop being preferred once a near-identical one is on the deck.
 */
export function rankCandidates(candidates: Candidate[], used: number[][], anchor?: number): Candidate[] {
  return candidates
    .filter((candidate) => candidate.score > 0)
    .map((candidate) => {
      const nearest = used.reduce(
        (min, signature) => Math.min(min, signatureDistance(candidate.signature, signature)),
        1
      );
      const drift = anchor === undefined ? 0 : Math.abs(candidate.seconds - anchor);
      const proximity = Math.max(0.1, 1 - drift * DRIFT_PENALTY_PER_SEC);
      return {
        candidate,
        value: (nearest < DISTINCT_DISTANCE ? candidate.score * 0.35 : candidate.score) * proximity
      };
    })
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.candidate);
}

/** The single best candidate for a slot. */
export function pickCandidate(candidates: Candidate[], used: number[][], anchor?: number): Candidate | null {
  return rankCandidates(candidates, used, anchor)[0] ?? null;
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

/**
 * A copy of a candidate, only ever made to be looked at.
 *
 * Stored at the same width as the real still, NOT thumbnailed. The judgement
 * being asked for is "is the thing the slide names actually on this screen",
 * and a 1920-wide desktop capture shrunk to 640 has unreadable window titles
 * and tab labels — every screen-share frame then honestly comes back "I cannot
 * find it", and the gate rejects the whole deck.
 */
async function previewFrame(videoPath: string, seconds: number, outPath: string): Promise<Uint8Array | null> {
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-ss", String(seconds),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", `scale=${STORED_FRAME_WIDTH}:-2`,
      "-q:v", "3",
      "-y", outPath
    ]);
    const bytes = await readFile(outPath);
    return bytes.length ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * The candidate to actually use.
 *
 * Without a vision credential this is just the best-looking frame nearest the
 * anchor, exactly as before. With one, the top few are shown to a model along
 * with the slide's words and the first that clears the bar wins — and if none
 * of them do, the slide gets NO picture. A still that contradicts the words
 * ("the transcript is right there" over a music generator) is worse than a
 * plain slide, which is the same rule this module already applied to fades.
 *
 * Every failure to look falls back to the looks-only pick, so a dead endpoint
 * or a spent balance degrades to the old behaviour instead of an empty deck.
 */
async function chooseByRelevance(input: {
  videoPath: string;
  workDir: string;
  index: number;
  ranked: Candidate[];
  slide?: { heading?: string; body?: string };
}): Promise<Candidate | null> {
  const best = input.ranked[0] ?? null;
  if (!frameRelevanceConfigured() || !input.slide) return best;

  // Every candidate is rated and the BEST wins, rather than the first one over
  // the line. They are seconds apart and differ only in the instant caught, so
  // this is what steps off a blink, a mid-word mouth or a hand smeared across
  // the face — the whole remaining failure once the moment itself is right.
  let looked = false;
  let winner: { candidate: Candidate; score: number } | null = null;
  for (const candidate of input.ranked.slice(0, RATED_CANDIDATES)) {
    const jpeg = await previewFrame(
      input.videoPath,
      candidate.seconds,
      path.join(input.workDir, `p${input.index}-${Math.round(candidate.seconds)}.jpg`)
    );
    if (!jpeg) continue;
    const score = await rateFrame({ slide: input.slide, jpeg });
    if (score === null) continue;
    looked = true;
    if (!winner || score > winner.score) winner = { candidate, score };
  }
  if (!looked) return best;
  return winner && winner.score >= MIN_FRAME_RELEVANCE ? winner.candidate : null;
}

export type ExtractedFrames = {
  /**
   * Stored stills, POSITIONAL: entry N belongs to slide N, and a null is a
   * slide that gets no picture rather than a wrong one.
   */
  images: Array<CarouselImage | null>;
  /** Why fewer (or none) came back, for the run's notes. */
  note: string | null;
};

/**
 * Extracts one still per slide, from the moment that slide's copy was drawn
 * from, chosen on looks within a few seconds of it. Never throws: a missing
 * ffmpeg or an unreadable file comes back as an empty set with a note, and the
 * carousel is written without pictures rather than not written at all.
 */
export async function extractVideoFrames(input: {
  videoPath: string;
  durationSec: number;
  /** Seconds to illustrate, one per slide — see `anchorSlides`. */
  targets: number[];
  /** The words each still has to fit, when there is a credential to check with. */
  slides?: Array<{ heading?: string; body?: string }>;
}): Promise<ExtractedFrames> {
  const targets = input.targets.filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
  if (!targets.length) return { images: [], note: null };

  let workDir: string;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), "cc-frames-"));
  } catch {
    return { images: [], note: "Could not open a working folder for the video stills." };
  }

  const images: Array<CarouselImage | null> = [];
  const used: number[][] = [];
  let rejected = 0;
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

      const ranked = rankCandidates(candidates, used, target);
      if (!ranked.length) {
        images.push(null);
        continue;
      }

      const chosen = await chooseByRelevance({
        videoPath: input.videoPath,
        workDir,
        index,
        ranked,
        slide: input.slides?.[index]
      });
      if (!chosen) {
        rejected += 1;
        images.push(null);
        continue;
      }

      const stored = await storeFrame(
        input.videoPath,
        chosen.seconds,
        path.join(workDir, `s${index}.jpg`),
        `frame-${String(index + 1).padStart(2, "0")}-${stamp(chosen.seconds)}.jpg`
      );
      images.push(stored);
      if (stored) used.push(chosen.signature);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const taken = images.filter(Boolean).length;
  if (taken === 0) {
    return { images: [], note: "No usable stills could be taken from the video — the slides have no pictures." };
  }
  if (taken < targets.length) {
    const missing = targets.length - taken;
    return {
      images,
      note: rejected
        ? `${missing} of ${targets.length} slides were left without a still — nothing near that moment showed what the slide says.`
        : `Only ${taken} of ${targets.length} slides got a still from the video.`
    };
  }
  return { images, note: null };
}

/**
 * Stills for a stored clip/long-form source id — what both the Stream Pipeline
 * and the Video Studio use, so a carousel written from a recording looks the
 * same however it was asked for.
 */
export async function framesForSource(sourceId: string, targets: number[]): Promise<ExtractedFrames> {
  const meta = await readSourceMeta(sourceId);
  if (!meta) return { images: [], note: "The video this was written from is no longer on disk." };
  return extractVideoFrames({ videoPath: sourceFilePath(meta), durationSec: meta.durationSec, targets });
}

/**
 * Stills for a deck the model has just written: anchors each slide in the
 * recording, then cuts a frame at each anchor.
 *
 * The copy is written FIRST and illustrated after, which is the whole point: a
 * slide about the agent terminal gets the second the agent terminal was on
 * screen, not the second its position in the deck happens to fall on.
 */
export async function framesForSlides(input: {
  sourceId: string;
  slides: Array<{ heading?: string; body?: string; atSeconds?: number | null }>;
  segments: TranscriptSegment[];
}): Promise<ExtractedFrames & { anchors: SlideAnchor[] }> {
  const meta = await readSourceMeta(input.sourceId);
  if (!meta) {
    return { images: [], anchors: [], note: "The video this was written from is no longer on disk." };
  }
  const anchors = anchorSlides({ slides: input.slides, segments: input.segments, durationSec: meta.durationSec });
  const frames = await extractVideoFrames({
    videoPath: sourceFilePath(meta),
    durationSec: meta.durationSec,
    targets: anchors.map((anchor) => anchor.seconds),
    slides: input.slides
  });
  return { ...frames, anchors };
}
