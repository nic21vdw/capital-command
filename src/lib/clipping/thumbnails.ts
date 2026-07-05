import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";

// Poster frames for the clip cards. Generated lazily from the rendered clip
// (and eagerly right after a render), so jobs created before thumbnails
// existed get them the first time their thumbnail is requested — no
// re-render or data migration needed.

// Same globalThis trick as jobs.ts: dedupe concurrent generations across the
// separate module graphs Next dev creates per route.
type ThumbsGlobal = typeof globalThis & {
  __clipThumbTasks?: Map<string, Promise<string | null>>;
};
const g = globalThis as ThumbsGlobal;
const inFlight = (g.__clipThumbTasks ??= new Map<string, Promise<string | null>>());

export function thumbnailPath(clipDir: string, fileName: string) {
  return path.join(clipDir, "thumbs", `${fileName}.jpg`);
}

/**
 * Returns the path of a poster frame for the given rendered clip, extracting
 * it with ffmpeg if it doesn't exist yet (or is older than the clip file).
 * Returns null when the clip file is missing or extraction fails.
 */
export async function ensureClipThumbnail(clipDir: string, fileName: string): Promise<string | null> {
  const videoPath = path.join(clipDir, fileName);
  const thumbPath = thumbnailPath(clipDir, fileName);

  let videoStat;
  try {
    videoStat = await stat(videoPath);
  } catch {
    return null;
  }
  try {
    const thumbStat = await stat(thumbPath);
    if (thumbStat.size > 0 && thumbStat.mtimeMs >= videoStat.mtimeMs) return thumbPath;
  } catch {
    // Not generated yet.
  }

  const key = thumbPath;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = extractFrame(videoPath, thumbPath).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function extractFrame(videoPath: string, thumbPath: string): Promise<string | null> {
  await mkdir(path.dirname(thumbPath), { recursive: true });
  // Grab a frame ~1s in to skip any black lead-in; fall back to the very
  // first frame for clips shorter than that.
  for (const seek of ["1", "0"]) {
    try {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel", "error",
        "-ss", seek,
        "-i", videoPath,
        "-frames:v", "1",
        "-vf", "scale=480:-2",
        "-q:v", "4",
        "-y",
        thumbPath
      ]);
      const produced = await stat(thumbPath);
      if (produced.size > 0) return thumbPath;
    } catch {
      // Try the next seek point.
    }
  }
  return null;
}
