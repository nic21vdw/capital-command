import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveCarouselAsset } from "@/lib/carousels/assets";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { getProject } from "@/lib/longform/store";

type FrameSource = { file: string; start: number; end: number };

async function resolveFrameSource(sourceType: string, sourceId: string): Promise<FrameSource | null> {
  if (sourceType === "longform") {
    const project = await getProject(sourceId);
    if (!project?.sourceId) return null;
    const meta = await readSourceMeta(project.sourceId);
    if (!meta) return null;
    return { file: sourceFilePath(meta), start: 0, end: Math.max(0.1, project.durationSec || meta.durationSec) };
  }

  if (sourceType === "short") {
    const separator = sourceId.indexOf(":");
    if (separator < 1) return null;
    const jobId = sourceId.slice(0, separator);
    const clipId = sourceId.slice(separator + 1);
    const job = await getJob(jobId);
    const clip = job?.clips.find((entry) => entry.id === clipId);
    if (!job || !clip) return null;

    if (job.sourceId) {
      const meta = await readSourceMeta(job.sourceId);
      if (meta) return { file: sourceFilePath(meta), start: clip.start, end: clip.end };
    }

    const rendered = clip.editedFile || clip.previewFile || clip.file;
    if (!rendered) return null;
    return {
      file: path.join(outputDir(job.id), rendered),
      start: 0,
      end: Math.max(0.1, clip.end - clip.start)
    };
  }

  return null;
}

/**
 * Extracts evenly spaced stills from the exact stream or clip that supplied
 * the carousel copy, persists them as carousel assets, and returns their URLs.
 */
export async function extractCarouselFrames(input: {
  sourceType: string;
  sourceId: string;
  count: number;
}): Promise<string[]> {
  const count = Math.max(1, Math.min(12, Math.round(input.count) || 1));
  const source = await resolveFrameSource(input.sourceType, input.sourceId);
  if (!source) throw new Error("The original stream video is not available for this carousel.");

  const duration = Math.max(0.1, source.end - source.start);
  const work = await mkdtemp(path.join(tmpdir(), "capital-carousel-frames-"));
  const frames: string[] = [];

  try {
    const times = Array.from(
      { length: count },
      (_, index) => source.start + duration * ((index + 0.5) / count)
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < times.length) {
        const index = cursor++;
        const target = path.join(work, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
        await runFfmpeg([
          "-y",
          "-ss",
          times[index].toFixed(3),
          "-i",
          source.file,
          "-frames:v",
          "1",
          "-vf",
          "scale=720:-2:force_original_aspect_ratio=decrease",
          "-q:v",
          "3",
          target
        ]);
        frames[index] = await saveCarouselAsset(await readFile(target), "jpg");
      }
    };

    await Promise.all(Array.from({ length: Math.min(3, count) }, worker));
    return frames.filter(Boolean);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
