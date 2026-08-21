import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  frameScore,
  frameSignature,
  frameStats,
  signatureDistance
} from "@/lib/carousels/videoFrames";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import {
  FACECAM_SAMPLE_HEIGHT,
  FACECAM_SAMPLE_WIDTH,
  type FacecamRect,
  detectFacecam,
  faceCrop,
  skinFraction
} from "@/lib/longform/facecam";
import { projectWorkDir } from "@/lib/longform/store";
import type { LongformProject } from "@/lib/longform/types";

const SCAN_COUNT = 32;
const KEEP_COUNT = 6;
const FACE_SAMPLES = 16;
const MIN_FACE_FRACTION = 0.05;
const GOOD_FACE_FRACTION = 0.2;
const DISTINCT_DISTANCE = 0.02;
const MIN_GAP_SEC = 8;
const WINDOW_MARGIN = 0.08;
const FULL_WIDTH = 1280;
const FACE_HEIGHT = 768;
const UPSCALE = "flags=lanczos";
const SHARPEN = "unsharp=5:5:1.2:5:5:0.2";

export type ThumbnailCandidate = {
  id: string;
  seconds: number;
  score: number;
  faceScore: number;
  hasFace: boolean;
};

export type ThumbnailCandidates = {
  key: string;
  topicId: string | null;
  facecam: FacecamRect | null;
  candidates: ThumbnailCandidate[];
  builtAt: string;
};

export function candidatesKey(topicId?: string | null) {
  return topicId ?? "project";
}

export function thumbnailWorkDir(projectId: string) {
  return path.join(projectWorkDir(projectId), "thumbs");
}

export function candidateFilePath(projectId: string, frameId: string, face: boolean) {
  return path.join(thumbnailWorkDir(projectId), `${frameId}${face ? "-face" : ""}.jpg`);
}

function manifestPath(projectId: string, key: string) {
  return path.join(thumbnailWorkDir(projectId), `${key}.json`);
}

export async function readThumbnailCandidates(
  projectId: string,
  topicId?: string | null
): Promise<ThumbnailCandidates | null> {
  try {
    const raw = await readFile(manifestPath(projectId, candidatesKey(topicId)), "utf8");
    return JSON.parse(raw) as ThumbnailCandidates;
  } catch {
    return null;
  }
}

export async function buildThumbnailCandidates(
  project: LongformProject,
  topicId?: string | null
): Promise<ThumbnailCandidates | null> {
  const meta = await readSourceMeta(project.sourceId);
  if (!meta) return null;
  const videoPath = sourceFilePath(meta);
  const workDir = thumbnailWorkDir(project.id);
  await mkdir(workDir, { recursive: true });

  const [from, to] = scanWindow(project, topicId);
  if (to - from < 1) return null;
  const probePath = path.join(workDir, "probe.raw");

  const scanned: ScannedFrame[] = [];
  for (const seconds of spread(from, to, SCAN_COUNT)) {
    const gray = await sampleRaw(videoPath, seconds, probePath, SAMPLE_WIDTH, SAMPLE_HEIGHT, "gray");
    if (!gray) continue;
    const score = frameScore(frameStats(gray));
    if (score <= 0) continue;
    scanned.push({ seconds, score, signature: frameSignature(gray) });
  }
  if (scanned.length === 0) return null;

  const ranked = [...scanned].sort((a, b) => b.score - a.score).slice(0, FACE_SAMPLES);
  const looks = await sampleLooks(videoPath, ranked, probePath);
  const facecam = consensusRect(
    looks
      .map((look) => detectFacecam(look.rgb))
      .filter((rect): rect is FacecamRect => rect !== null)
      .map((rect) => faceCrop(rect, frameAspect(project)))
  );

  const scored = looks
    .map((look) => {
      const faceScore = facecam ? skinFraction(look.rgb, facecam) : 0;
      const withFace = facecam
        ? look.frame.score * 0.35 + Math.min(1, faceScore / GOOD_FACE_FRACTION) * 0.65
        : look.frame.score;
      return { ...look.frame, faceScore, score: withFace };
    })
    .filter((frame) => !facecam || frame.faceScore >= MIN_FACE_FRACTION)
    .sort((a, b) => b.score - a.score);

  const kept = spreadOut(scored, Math.max(MIN_GAP_SEC, (to - from) / (KEEP_COUNT * 3)));
  kept.sort((a, b) => a.seconds - b.seconds);

  const candidates: ThumbnailCandidate[] = [];
  for (const [index, frame] of kept.entries()) {
    const id = `${candidatesKey(topicId)}-${index + 1}`;
    const full = await extractStill(videoPath, frame.seconds, candidateFilePath(project.id, id, false), null, project);
    if (!full) continue;
    const face = facecam
      ? await extractStill(videoPath, frame.seconds, candidateFilePath(project.id, id, true), facecam, project)
      : false;
    candidates.push({
      id,
      seconds: frame.seconds,
      score: Number(frame.score.toFixed(4)),
      faceScore: Number(frame.faceScore.toFixed(4)),
      hasFace: face
    });
  }
  if (candidates.length === 0) return null;

  const manifest: ThumbnailCandidates = {
    key: candidatesKey(topicId),
    topicId: topicId ?? null,
    facecam,
    candidates,
    builtAt: new Date().toISOString()
  };
  await writeFile(manifestPath(project.id, manifest.key), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

/**
 * Six frames from across the segment rather than six of the same moment. A
 * coding stream barely changes between frames, so telling candidates apart by
 * how they look picks two and stops; the useful spread is over TIME, with the
 * visual check left in only to drop frames that really are the same shot.
 */
function spreadOut<T extends { seconds: number; signature: number[] }>(frames: T[], minGapSec: number): T[] {
  const kept: T[] = [];
  const farEnough = (frame: T) => kept.every((chosen) => Math.abs(chosen.seconds - frame.seconds) >= minGapSec);

  for (const frame of frames) {
    if (kept.length >= KEEP_COUNT) return kept;
    if (!farEnough(frame)) continue;
    if (kept.some((chosen) => signatureDistance(chosen.signature, frame.signature) <= DISTINCT_DISTANCE)) continue;
    kept.push(frame);
  }
  for (const frame of frames) {
    if (kept.length >= KEEP_COUNT) break;
    if (!kept.includes(frame) && farEnough(frame)) kept.push(frame);
  }
  return kept;
}

function scanWindow(project: LongformProject, topicId?: string | null): [number, number] {
  const topic = topicId ? project.topics?.find((item) => item.id === topicId) : undefined;
  if (topic) return [topic.start, topic.end];
  const duration = Math.max(0, project.durationSec);
  return [duration * WINDOW_MARGIN, duration * (1 - WINDOW_MARGIN)];
}

function spread(from: number, to: number, count: number): number[] {
  const step = (to - from) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => Number((from + index * step).toFixed(3)));
}

type ScannedFrame = { seconds: number; score: number; signature: number[] };

async function sampleLooks(videoPath: string, frames: ScannedFrame[], probePath: string) {
  const looks: { frame: ScannedFrame; rgb: Uint8Array }[] = [];
  for (const frame of frames) {
    const rgb = await sampleRaw(
      videoPath,
      frame.seconds,
      probePath,
      FACECAM_SAMPLE_WIDTH,
      FACECAM_SAMPLE_HEIGHT,
      "rgb24"
    );
    if (rgb) looks.push({ frame, rgb });
  }
  return looks;
}

const CLUSTER_CELL = 0.08;

/**
 * Where the facecam is for THIS recording, agreed across sampled frames. A
 * single frame can be read wrong — a warm-toned screen-share, an arm across
 * the desk — so the rects are grouped by where their centre falls and the
 * biggest group wins. A plain median loses to a handful of bad reads; the
 * mode does not, because the wrong answers disagree with each other too.
 */
export function consensusRect(rects: FacecamRect[]): FacecamRect | null {
  if (rects.length < 3) return medianRect(rects);
  const groups = new Map<string, FacecamRect[]>();
  for (const rect of rects) {
    const cellX = Math.round((rect.x + rect.width / 2) / CLUSTER_CELL);
    const cellY = Math.round((rect.y + rect.height / 2) / CLUSTER_CELL);
    const key = `${cellX}:${cellY}`;
    groups.set(key, [...(groups.get(key) ?? []), rect]);
  }
  const largest = [...groups.values()].reduce((best, group) => (group.length > best.length ? group : best));
  return medianRect(largest);
}

export function medianRect(rects: FacecamRect[]): FacecamRect | null {
  if (rects.length < 2) return rects[0] ?? null;
  const at = (pick: (rect: FacecamRect) => number) => {
    const values = rects.map(pick).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return { x: at((r) => r.x), y: at((r) => r.y), width: at((r) => r.width), height: at((r) => r.height) };
}

function frameAspect(project: LongformProject) {
  return project.height > 0 ? project.width / project.height : 16 / 9;
}

async function extractStill(
  videoPath: string,
  seconds: number,
  outPath: string,
  crop: FacecamRect | null,
  project: LongformProject
): Promise<boolean> {
  const filters: string[] = [];
  if (crop) {
    const width = even(crop.width * project.width);
    const height = even(crop.height * project.height);
    if (width < 16 || height < 16) return false;
    filters.push(`crop=${width}:${height}:${even(crop.x * project.width)}:${even(crop.y * project.height)}`);
    filters.push(`scale=-2:${FACE_HEIGHT}:${UPSCALE}`);
  } else {
    filters.push(`scale=${FULL_WIDTH}:-2:${UPSCALE}`);
  }
  filters.push(SHARPEN);

  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-ss", String(seconds),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", filters.join(","),
      "-q:v", "2",
      "-y",
      outPath
    ]);
    return (await stat(outPath)).size > 0;
  } catch {
    return false;
  }
}

function even(value: number) {
  return Math.max(0, Math.round(value / 2) * 2);
}

async function sampleRaw(
  videoPath: string,
  seconds: number,
  probePath: string,
  width: number,
  height: number,
  format: "gray" | "rgb24"
): Promise<Uint8Array | null> {
  const bytes = width * height * (format === "gray" ? 1 : 3);
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-ss", String(seconds),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", `scale=${width}:${height},format=${format}`,
      "-f", "rawvideo",
      "-pix_fmt", format,
      "-y",
      probePath
    ]);
    const data = await readFile(probePath);
    return data.length >= bytes ? new Uint8Array(data) : null;
  } catch {
    return null;
  }
}
