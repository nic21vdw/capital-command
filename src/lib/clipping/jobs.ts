import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectSilences, extractEnergy, fallbackCandidates, selectCandidates } from "@/lib/clipping/analysis";
import { downloadAudio, downloadSection, fetchVideoMeta } from "@/lib/clipping/download";
import { hasAudioStream, probeDuration } from "@/lib/clipping/ffmpeg";
import { generateClipMetadata } from "@/lib/clipping/metadata";
import { renderVertical, renderWide, type RenderRange } from "@/lib/clipping/render";
import { buildSrtForRange, excerptForRange, transcribe } from "@/lib/clipping/transcribe";
import type { ClipCandidate, ClipJob, TranscriptSegment } from "@/lib/clipping/types";

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
  const job = await newJob(id, fileName, topic, "upload");

  const sourcePath = path.join(uploadDir(id), `source${ext}`);
  await writeFile(sourcePath, sourceBytes);
  await persistJobs();

  // Run the pipeline without blocking the upload response; the client polls.
  void runUploadPipeline(job, sourcePath).catch((error) => failJob(job, error));
  return job;
}

export async function createJobFromUrl(url: string, topic: string | undefined): Promise<ClipJob> {
  await loadJobs();
  const id = crypto.randomUUID().slice(0, 8);
  const job = await newJob(id, url, topic, "url");
  job.sourceUrl = url;
  await persistJobs();

  void runUrlPipeline(job, url).catch((error) => failJob(job, error));
  return job;
}

async function newJob(
  id: string,
  fileName: string,
  topic: string | undefined,
  source: ClipJob["source"]
): Promise<ClipJob> {
  const job: ClipJob = {
    id,
    fileName,
    topic: topic || undefined,
    source,
    status: "queued",
    stage: source === "url" ? "downloading" : "uploading",
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
  return job;
}

async function failJob(job: ClipJob, error: unknown) {
  await update(job, { status: "error", error: error instanceof Error ? error.message : String(error) });
}

// --- Source-specific entry points -----------------------------------------

/** Pipeline for a browser-uploaded file: analyze and render from disk. */
async function runUploadPipeline(job: ClipJob, sourcePath: string) {
  await update(job, { status: "processing", stage: "probing", progress: 5 });
  const durationSec = await probeDuration(sourcePath);
  if (durationSec < 20) {
    throw new Error("The video is shorter than 20 seconds — upload a longer recording to clip from.");
  }
  await update(job, { durationSec: Math.round(durationSec) });

  const audioPresent = await hasAudioStream(sourcePath);
  await analyzeAndRender(job, {
    analysisInput: sourcePath,
    durationSec,
    audioPresent,
    // Each clip is trimmed straight out of the full uploaded file.
    prepareClipInput: async (clip) => ({
      inputPath: sourcePath,
      range: { start: clip.start, duration: clip.end - clip.start }
    })
  });
}

/** Pipeline for a pasted VOD URL: download audio for analysis, then fetch only the chosen ranges. */
async function runUrlPipeline(job: ClipJob, url: string) {
  await update(job, { status: "processing", stage: "downloading", progress: 5 });
  const meta = await fetchVideoMeta(url);
  if (meta.title) await update(job, { fileName: meta.title });
  if (meta.durationSec && meta.durationSec < 20) {
    throw new Error("That VOD is shorter than 20 seconds — pick a longer stream to clip from.");
  }

  // Audio-only download keeps this fast even for multi-hour streams.
  const audioPath = await downloadAudio(url, uploadDir(job.id), (pct) =>
    void update(job, { progress: 5 + Math.round((pct / 100) * 12) })
  );
  const durationSec = meta.durationSec || (await probeDuration(audioPath));
  await update(job, { durationSec: Math.round(durationSec) });

  await analyzeAndRender(job, {
    analysisInput: audioPath,
    durationSec,
    audioPresent: true,
    // Each clip is fetched as its own short section straight from the source URL.
    prepareClipInput: async (clip, index) => {
      const segPath = path.join(uploadDir(job.id), `seg-${String(index + 1).padStart(2, "0")}.mp4`);
      const produced = await downloadSection(url, clip.start, clip.end, segPath);
      return { inputPath: produced, cleanup: produced };
    }
  });
}

// --- Shared analysis + render core ----------------------------------------

type PipelineOptions = {
  /** File the energy/silence/transcription analysis runs against. */
  analysisInput: string;
  durationSec: number;
  audioPresent: boolean;
  /** Resolves the input (and optional trim) for rendering a given clip. */
  prepareClipInput: (
    clip: ClipCandidate,
    index: number
  ) => Promise<{ inputPath: string; range?: RenderRange; cleanup?: string }>;
};

async function analyzeAndRender(job: ClipJob, opts: PipelineOptions) {
  const { analysisInput, durationSec, audioPresent } = opts;
  let transcriptSegments: TranscriptSegment[] | null = null;

  // 1. Audio energy + silence analysis (works fully offline).
  if (audioPresent) {
    await update(job, { stage: "analyzing-audio", progress: 22 });
    const [windows, silences] = await Promise.all([extractEnergy(analysisInput), detectSilences(analysisInput)]);

    // 2. Optional transcription (Whisper), chunked for long recordings.
    await update(job, { stage: "transcribing", progress: 32 });
    const transcript = await transcribe(analysisInput, uploadDir(job.id));
    if (transcript.segments) {
      transcriptSegments = transcript.segments;
      await update(job, { transcriptAvailable: true });
    } else {
      job.notices.push(transcript.reason);
    }

    await update(job, { stage: "selecting-clips", progress: 44 });
    job.clips = selectCandidates(windows, silences, durationSec);
  } else {
    job.notices.push("This video has no audio track, so clips were spaced evenly instead of ranked by energy.");
    await update(job, { stage: "selecting-clips", progress: 44 });
    job.clips = fallbackCandidates(durationSec, "No audio track");
  }
  await persistJobs();

  // 3. Render each candidate as both a vertical 9:16 short and a 16:9 widescreen cut.
  for (let i = 0; i < job.clips.length; i++) {
    const clip = job.clips[i];
    await update(job, { stage: "rendering-clips", progress: 46 + Math.round((i / job.clips.length) * 38) });
    try {
      const { inputPath, range, cleanup } = await opts.prepareClipInput(clip, i);
      const verticalName = `clip-${String(i + 1).padStart(2, "0")}.mp4`;
      const wideName = `clip-${String(i + 1).padStart(2, "0")}-wide.mp4`;
      await renderVertical(inputPath, path.join(outputDir(job.id), verticalName), audioPresent, range);
      await renderWide(inputPath, path.join(outputDir(job.id), wideName), audioPresent, range);
      clip.file = verticalName;
      clip.wideFile = wideName;
      if (cleanup) await unlink(cleanup).catch(() => undefined);
    } catch (error) {
      job.notices.push(
        `Clip ${i + 1} (${Math.round(clip.start)}s) could not be rendered: ${error instanceof Error ? error.message : String(error)}.`
      );
    }
    await persistJobs();
  }

  // 4. Per-clip SRT captions when a transcript exists.
  if (transcriptSegments) {
    await update(job, { stage: "writing-captions", progress: 88 });
    for (const clip of job.clips) {
      if (!clip.file) continue;
      const srt = buildSrtForRange(transcriptSegments, clip.start, clip.end);
      if (srt) {
        const srtName = clip.file.replace(/\.mp4$/, ".srt");
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
