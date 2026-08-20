import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSourceMeta, sourceDir, sourceFilePath } from "@/lib/clipping/sources";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";

/**
 * What KIND of recording this is: a desk capture of software being built, or a
 * person talking to a camera with nothing else in shot.
 *
 * The car videos are why this exists. They are shot landscape at 1920x1080,
 * exactly like a stream VOD, so nothing about their shape, their file or their
 * duration gives them away — and the provenance that would (an ordinary upload
 * rather than a live broadcast) is dropped at the ingest boundary long before a
 * carousel is written. The difference is in the pixels, so the pixels are what
 * get measured.
 *
 * The measure is edge ORIENTATION. A screen is drawn out of rectangles: window
 * chrome, panels, rows of code, tabs, borders — a large share of its strong
 * edges are purely horizontal or purely vertical. A face in a car has almost
 * none: cheeks, hair, seats and windscreens curve. On this channel's own
 * recordings the two do not overlap or come close — five car videos measure
 * .076-.089 and five streams .227-.260 — so the line between them sits in a
 * gap two and a half times wide on either side.
 *
 * No credential, no model, no network. Costs nine grabbed frames, once per
 * recording, cached beside it.
 */

export type FootageKind = "desk" | "talking-head";

const CACHE_FILE = "footage.json";

/** Size of the grayscale sample each frame is measured from. */
export const SAMPLE_WIDTH = 256;
export const SAMPLE_HEIGHT = 144;

/** Where in the recording the frames are taken from, as fractions of its length. */
export const PROBE_POSITIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/**
 * The share of axis-aligned strong edges above which a recording is a screen.
 * Sits in the empty middle of the two populations measured on this channel —
 * `scripts/calibrate-footage.ts` re-runs that measurement.
 */
export const SCREEN_EDGE_THRESHOLD = 0.15;

/** A gradient this small is flat — no edge at all, just sensor noise. */
const EDGE_FLOOR = 6;
/** How strong the dominant direction must be before an edge is worth counting. */
const EDGE_STRENGTH = 18;
/** How much weaker the other direction must be for the edge to count as axis-aligned. */
const AXIS_RATIO = 0.25;

/**
 * The fraction of a frame's pixels sitting on a strong horizontal or vertical
 * edge. High for a user interface, low for anything the world made.
 */
export function screenEdgeShare(gray: Uint8Array, width = SAMPLE_WIDTH, height = SAMPLE_HEIGHT): number {
  if (gray.length < width * height) return 0;
  let axis = 0;
  let total = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = Math.abs(gray[i + 1] - gray[i - 1]);
      const gy = Math.abs(gray[i + width] - gray[i - width]);
      total += 1;
      if (gx + gy < EDGE_FLOOR) continue;
      const strong = Math.max(gx, gy);
      const weak = Math.min(gx, gy);
      if (strong > EDGE_STRENGTH && weak < strong * AXIS_RATIO) axis += 1;
    }
  }
  return total ? axis / total : 0;
}

/**
 * The verdict for a set of measured frames. The MEDIAN, not the mean: a stream
 * that cuts to a full-screen webcam for a minute, or a car video that holds up
 * a phone, should not drag the whole recording across the line.
 */
export function verdictFromShares(shares: number[]): FootageKind | null {
  if (!shares.length) return null;
  const sorted = [...shares].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median >= SCREEN_EDGE_THRESHOLD ? "desk" : "talking-head";
}

async function readCache(sourceId: string): Promise<FootageKind | null> {
  const raw = await readFile(path.join(sourceDir(sourceId), CACHE_FILE), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const kind = (JSON.parse(raw) as { kind?: unknown }).kind;
    return kind === "desk" || kind === "talking-head" ? kind : null;
  } catch {
    return null;
  }
}

async function sampleFrame(videoPath: string, seconds: number, outPath: string): Promise<Uint8Array | null> {
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-ss", String(seconds),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT},format=gray`,
      "-f", "rawvideo",
      "-pix_fmt", "gray",
      "-y", outPath
    ]);
    const bytes = await readFile(outPath);
    return bytes.length >= SAMPLE_WIDTH * SAMPLE_HEIGHT ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * What kind of recording this is. Cached, and never throws — a missing ffmpeg
 * or an unreadable file answers "desk", which illustrates the deck exactly as
 * it always was rather than not at all.
 */
export async function footageKind(sourceId: string): Promise<FootageKind> {
  const cached = await readCache(sourceId);
  if (cached) return cached;

  const meta = await readSourceMeta(sourceId).catch(() => null);
  if (!meta) return "desk";

  let verdict: FootageKind | null = null;
  // A recording shot upright is a phone video and needs no measuring.
  if (meta.width > 0 && meta.height > meta.width) {
    verdict = "talking-head";
  } else {
    const workDir = await mkdtemp(path.join(tmpdir(), "cc-footage-")).catch(() => null);
    if (!workDir) return "desk";
    try {
      const shares = await Promise.all(
        PROBE_POSITIONS.map(async (position, index) => {
          const gray = await sampleFrame(sourceFilePath(meta), meta.durationSec * position, path.join(workDir, `k${index}.gray`));
          return gray ? screenEdgeShare(gray) : null;
        })
      );
      verdict = verdictFromShares(shares.filter((share): share is number => share !== null));
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (!verdict) return "desk";
  await writeFile(path.join(sourceDir(sourceId), CACHE_FILE), `${JSON.stringify({ kind: verdict }, null, 2)}\n`).catch(() => {});
  return verdict;
}
