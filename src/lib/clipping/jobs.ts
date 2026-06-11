import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectSilences, extractEnergy, fallbackCandidates, selectCandidates } from "@/lib/clipping/analysis";
import { hasAudioStream, probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { generateClipMetadata } from "@/lib/clipping/metadata";
import { buildSrtForRange, excerptForRange, transcribe } from "@/lib/clipping/transcribe";
import type { ClipJob, TranscriptSegment } from "@/lib/clipping/types";

const clipsRoot = path.join(process.cwd(), "data", "clips");
const jobsFile = path.join(clipsRoot, "jobs.json");

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const ACCEPTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo"
]);

// Job state lives on globalThis: in Next dev each route gets its own module
// graph, so plain module-level state would not be shared between the upload
// route and the status routes.
type JobsGlobal = typeof globalThis & {
  __clipJobs?: Map<string, ClipJob>;
  __clipJobsLoaded?: boolean;
};
const g = globalThis as JobsGlobal;
const jobs = (g.__clipJobs ??= new Map<string, ClipJob>());

async function loadJobs() {
  if (g.__clipJobsLoaded) return;
  g.__clipJobsLoaded = true;
  try {
    const raw = await readFile(jobsFile, "utf8");
    for (const job of JSON.parse(raw) as ClipJob[]) {
      // Anything mid-flight when the server stopped can't resume.
      if (job.status === "processing" || job.status === "queued") {
        job.status = "error";
        job.error = "The server restarted while this job was processing. Upload the video again.";
      }
      jobs.set(job.id, job);
    }
  } catch {
    // First run — no jobs file yet.
  }
}

async function persistJobs() {
  await mkdir(clipsRoot, { recursive: true });
  const list = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  await writeFile(jobsFile, JSON.stringify(list, null, 2), "utf8");
}

export async function listJobs(): Promise<ClipJob[]> {
  await loadJobs();
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJob(id: string): Promise<ClipJob | undefined> {
  await loadJobs();
  return jobs.get(id);
}

export function uploadDir(jobId: string) {
  return path.join(clipsRoot, "uploads", jobId);
}

export function outputDir(jobId: string) {
  return path.join(clipsRoot, "outputs", jobId);
}

export async function deleteJob(id: string) {
  await loadJobs();
  jobs.delete(id);
  await rm(uploadDir(id), { recursive: true, force: true });
  await rm(outputDir(id), { recursive: true, force: true });
  await persistJobs();
}

async function update(job: ClipJob, patch: Partial<ClipJob>) {
  Object.assign(job, patch);
  await persistJobs();
}

export async function createJob(fileName: string, topic: string | undefined, sourceBytes: Buffer): Promise<ClipJob> {
  await loadJobs();
  const id = crypto.randomUUID().slice(0, 8);
  const ext = path.extname(fileName).toLowerCase() || ".mp4";
  const job: ClipJob = {
    id,
    fileName,
    topic: topic || undefined,
    status: "queued",
    stage: "uploading",
    progress: 2,
    notices: [],
    createdAt: new Date().toISOString(),
    transcriptAvailable: false,
    metadataAvailable: false,
    clips: []
  };
  jobs.set(id, job);

  await mkdir(uploadDir(id), { recursive: true });
  await mkdir(outputDir(id), { recursive: true });
  const sourcePath = path.join(uploadDir(id), `source${ext}`);
  await writeFile(sourcePath, sourceBytes);
  await persistJobs();

  // Run the pipeline without blocking the upload response; the client polls.
  void runPipeline(job, sourcePath).catch(async (error) => {
    await update(job, {
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return job;
}

async function runPipeline(job: ClipJob, sourcePath: string) {
  await update(job, { status: "processing", stage: "probing", progress: 5 });
  const durationSec = await probeDuration(sourcePath);
  if (durationSec < 20) {
    throw new Error("The video is shorter than 20 seconds — upload a longer recording to clip from.");
  }
  await update(job, { durationSec: Math.round(durationSec) });

  // 1. Audio energy + silence analysis (works fully offline).
  const audioPresent = await hasAudioStream(sourcePath);
  let transcriptSegments: TranscriptSegment[] | null = null;

  if (audioPresent) {
    await update(job, { stage: "analyzing-audio", progress: 12 });
    const [windows, silences] = await Promise.all([extractEnergy(sourcePath), detectSilences(sourcePath)]);

    // 2. Optional transcription (Whisper).
    await update(job, { stage: "transcribing", progress: 30 });
    const transcript = await transcribe(sourcePath, uploadDir(job.id));
    if (transcript.segments) {
      transcriptSegments = transcript.segments;
      await update(job, { transcriptAvailable: true });
    } else {
      job.notices.push(transcript.reason);
    }

    await update(job, { stage: "selecting-clips", progress: 42 });
    job.clips = selectCandidates(windows, silences, durationSec);
  } else {
    job.notices.push("This video has no audio track, so clips were spaced evenly instead of ranked by energy.");
    await update(job, { stage: "selecting-clips", progress: 42 });
    job.clips = fallbackCandidates(durationSec, "No audio track");
  }
  await persistJobs();

  // 3. Render each candidate as a vertical 9:16 clip (blurred-background pad).
  for (let i = 0; i < job.clips.length; i++) {
    const clip = job.clips[i];
    await update(job, {
      stage: "rendering-clips",
      progress: 45 + Math.round((i / job.clips.length) * 40)
    });
    const fileName = `clip-${String(i + 1).padStart(2, "0")}.mp4`;
    await runFfmpeg([
      "-y",
      "-ss",
      String(clip.start),
      "-t",
      String(clip.end - clip.start),
      "-i",
      sourcePath,
      "-filter_complex",
      "[0:v]split=2[bg][fg];" +
        "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4,eq=brightness=-0.08[bgb];" +
        "[fg]scale=1080:-2[fgs];" +
        "[bgb][fgs]overlay=(W-w)/2:(H-h)/2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      ...(audioPresent ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      "-movflags",
      "+faststart",
      path.join(outputDir(job.id), fileName)
    ]);
    clip.file = fileName;
  }

  // 4. Per-clip SRT captions when a transcript exists.
  if (transcriptSegments) {
    await update(job, { stage: "writing-captions", progress: 88 });
    for (const clip of job.clips) {
      const srt = buildSrtForRange(transcriptSegments, clip.start, clip.end);
      if (srt) {
        const srtName = clip.file!.replace(/\.mp4$/, ".srt");
        await writeFile(path.join(outputDir(job.id), srtName), srt, "utf8");
        clip.srtFile = srtName;
      }
      clip.transcriptExcerpt = excerptForRange(transcriptSegments, clip.start, clip.end) || undefined;
    }
  }

  // 5. Optional metadata suggestions via Claude.
  await update(job, { stage: "generating-metadata", progress: 92 });
  try {
    const result = await generateClipMetadata(job.clips, job.topic, Boolean(transcriptSegments));
    if (result.metadata) {
      for (const clip of job.clips) {
        clip.metadata = result.metadata.get(clip.id);
      }
      await update(job, { metadataAvailable: true });
    } else {
      job.notices.push(result.reason);
    }
  } catch (error) {
    job.notices.push(
      `Metadata suggestions failed: ${error instanceof Error ? error.message : String(error)}. Clips are still ready below.`
    );
  }

  await update(job, { status: "done", stage: "finished", progress: 100 });
}
