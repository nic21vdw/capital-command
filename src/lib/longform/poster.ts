import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { SAMPLE_HEIGHT, SAMPLE_WIDTH, frameScore, frameStats } from "@/lib/carousels/videoFrames";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { ensureClipThumbnail } from "@/lib/clipping/thumbnails";
import { projectOutputDir, projectWorkDir } from "@/lib/longform/store";
import type { LongformExportRecord, LongformProject } from "@/lib/longform/types";

const CANDIDATE_COUNT = 12;
const SAMPLE_MARGIN = 0.1;
const POSTER_WIDTH = 480;

type PosterGlobal = typeof globalThis & {
  __longformPosterTasks?: Map<string, Promise<string | null>>;
};
const g = globalThis as PosterGlobal;
const inFlight = (g.__longformPosterTasks ??= new Map<string, Promise<string | null>>());

export type PosterKind = "generated" | "export" | "source";
export type ProjectPoster = { path: string; kind: PosterKind };

export function generatedThumbnailName(exportId: string) {
  return `thumb-${exportId}.png`;
}

export function generatedThumbnailPath(projectId: string, exportId: string) {
  return path.join(projectOutputDir(projectId), generatedThumbnailName(exportId));
}

export function posterExport(project: LongformProject): LongformExportRecord | null {
  const done = project.exports.filter((record) => record.status === "done" && record.file);
  if (done.length === 0) return null;
  const withThumbnail = done.filter((record) => record.thumbnailFile);
  const pool = withThumbnail.length > 0 ? withThumbnail : done;
  return pool.reduce((newest, record) =>
    Date.parse(record.createdAt) > Date.parse(newest.createdAt) ? record : newest
  );
}

export async function ensureProjectPoster(project: LongformProject): Promise<ProjectPoster | null> {
  const record = posterExport(project);
  if (record) {
    if (record.thumbnailFile) {
      const generated = path.join(projectOutputDir(project.id), record.thumbnailFile);
      if (await fileExists(generated)) return { path: generated, kind: "generated" };
    }
    const poster = await ensureClipThumbnail(projectOutputDir(project.id), record.file!);
    if (poster) return { path: poster, kind: "export" };
  }
  const fromSource = await ensureSourcePoster(project);
  return fromSource ? { path: fromSource, kind: "source" } : null;
}

export function sourcePosterPath(projectId: string) {
  return path.join(projectWorkDir(projectId), "poster.jpg");
}

async function ensureSourcePoster(project: LongformProject): Promise<string | null> {
  const posterPath = sourcePosterPath(project.id);
  if (await fileExists(posterPath)) return posterPath;

  const pending = inFlight.get(posterPath);
  if (pending) return pending;
  const task = pickSourcePoster(project, posterPath).finally(() => inFlight.delete(posterPath));
  inFlight.set(posterPath, task);
  return task;
}

async function pickSourcePoster(project: LongformProject, posterPath: string): Promise<string | null> {
  const meta = await readSourceMeta(project.sourceId);
  if (!meta) return null;
  const videoPath = sourceFilePath(meta);

  await mkdir(path.dirname(posterPath), { recursive: true });
  const probePath = path.join(projectWorkDir(project.id), "poster-probe.gray");

  let best: { seconds: number; score: number } | null = null;
  for (const seconds of candidateSeconds(project.durationSec)) {
    const gray = await sampleGray(videoPath, seconds, probePath);
    if (!gray) continue;
    const score = frameScore(frameStats(gray));
    if (score > 0 && (!best || score > best.score)) best = { seconds, score };
  }
  if (!best) return null;

  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-ss", String(best.seconds),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", `scale=${POSTER_WIDTH}:-2`,
      "-q:v", "4",
      "-y",
      posterPath
    ]);
    return (await stat(posterPath)).size > 0 ? posterPath : null;
  } catch {
    return null;
  }
}

function candidateSeconds(durationSec: number): number[] {
  const duration = Math.max(0, durationSec);
  if (duration <= 1) return [0];
  const from = duration * SAMPLE_MARGIN;
  const to = duration * (1 - SAMPLE_MARGIN);
  const step = (to - from) / Math.max(1, CANDIDATE_COUNT - 1);
  return Array.from({ length: CANDIDATE_COUNT }, (_, index) => Number((from + index * step).toFixed(3)));
}

async function sampleGray(videoPath: string, seconds: number, probePath: string): Promise<Uint8Array | null> {
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-ss", String(seconds),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT},format=gray`,
      "-f", "rawvideo",
      "-pix_fmt", "gray",
      "-y",
      probePath
    ]);
    const data = await readFile(probePath);
    return data.length >= SAMPLE_WIDTH * SAMPLE_HEIGHT ? new Uint8Array(data) : null;
  } catch {
    return null;
  }
}

async function fileExists(target: string) {
  try {
    return (await stat(target)).size > 0;
  } catch {
    return false;
  }
}
