import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectSilences, extractEnergy, selectCandidates } from "@/lib/clipping/analysis";
import { copyClipsToDrive, driveDir } from "@/lib/clipping/drive";
import { downloadAudio, downloadSection, fetchVideoMeta } from "@/lib/clipping/download";
import { probeDuration } from "@/lib/clipping/ffmpeg";
import { CLIP_LAYOUTS, DEFAULT_CLIP_LAYOUT } from "@/lib/clipping/layouts";
import { renderClipLayout } from "@/lib/clipping/render";
import { fetchAutoCaptions } from "@/lib/clipping/transcription";
import { selectByTranscript } from "@/lib/clipping/transcript-select";
import type { ClipCandidate, ClipJob, ClipLayoutOverrides, ClipLayoutPreset } from "@/lib/clipping/types";

const clipsRoot = path.join(process.cwd(), "data", "clips");
const jobsFile = path.join(clipsRoot, "jobs.json");
let persistQueue = Promise.resolve();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientReplaceError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

// Job state lives on globalThis: in Next dev each route gets its own module
// graph, so plain module-level state would not be shared between the create
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
    let raw = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        raw = await readFile(jobsFile, "utf8");
        JSON.parse(raw);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    }
    for (const job of JSON.parse(raw) as ClipJob[]) {
      // Anything mid-flight when the server stopped can't resume.
      if (job.status === "processing" || job.status === "queued") {
        job.status = "error";
        job.error = "The server restarted while this job was processing. Paste the link again.";
      }
      jobs.set(job.id, job);
    }
  } catch {
    // First run — no jobs file yet.
  }
}

async function persistJobs() {
  const write = async () => {
    await mkdir(clipsRoot, { recursive: true });
    const list = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
    const payload = JSON.stringify(list, null, 2);
    const tmpPath = `${jobsFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, payload, "utf8");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(tmpPath, jobsFile);
        return;
      } catch (error) {
        if (!isTransientReplaceError(error) || attempt === 4) {
          if (isTransientReplaceError(error)) {
            await writeFile(jobsFile, payload, "utf8");
            await unlink(tmpPath).catch(() => undefined);
            return;
          }
          await unlink(tmpPath).catch(() => undefined);
          throw error;
        }
        await wait(100 * (attempt + 1));
      }
    }
  };
  persistQueue = persistQueue.then(write, write);
  await persistQueue;
}

export async function listJobs(): Promise<ClipJob[]> {
  await loadJobs();
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJob(id: string): Promise<ClipJob | undefined> {
  await loadJobs();
  return jobs.get(id);
}

export function workDir(jobId: string) {
  return path.join(clipsRoot, "uploads", jobId);
}

export function outputDir(jobId: string) {
  return path.join(clipsRoot, "outputs", jobId);
}

export async function deleteJob(id: string) {
  await loadJobs();
  jobs.delete(id);
  await rm(workDir(id), { recursive: true, force: true });
  await rm(outputDir(id), { recursive: true, force: true });
  await persistJobs();
}

export async function retryMissingRenders(id: string): Promise<ClipJob | undefined> {
  await loadJobs();
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.status === "processing" || job.status === "queued") {
    throw new Error("This job is already processing.");
  }
  const missingIndexes = job.clips.map((clip, index) => (clip.file ? -1 : index)).filter((index) => index >= 0);
  if (missingIndexes.length === 0) return job;

  job.notices = job.notices.filter((notice) => !/^Clip \d+ \(/.test(notice));
  await update(job, { status: "processing", stage: "rendering", progress: 50, notices: job.notices });
  void renderClipIndexes(job, missingIndexes).catch((error) => failJob(job, error));
  return job;
}

async function update(job: ClipJob, patch: Partial<ClipJob>) {
  Object.assign(job, patch);
  await persistJobs();
}

/**
 * Fetches (and caches) automatic captions for a job from the source platform.
 * Force re-fetch to regenerate. Errors are stored on the job, not thrown, so a
 * source without captions degrades gracefully to manual captioning.
 */
export async function fetchJobCaptions(id: string, force = false): Promise<ClipJob | undefined> {
  await loadJobs();
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.sourceCaptions && job.sourceCaptions.length > 0 && !force) return job;
  try {
    const segments = await fetchAutoCaptions(job.sourceUrl, workDir(id));
    await update(job, { sourceCaptions: segments, captionsFetchedAt: new Date().toISOString(), captionsError: undefined });
  } catch (error) {
    await update(job, { captionsError: error instanceof Error ? error.message : String(error) });
  }
  return job;
}

async function failJob(job: ClipJob, error: unknown) {
  await update(job, { status: "error", error: error instanceof Error ? error.message : String(error) });
}

export async function createJobFromUrl(
  url: string,
  topic: string | undefined,
  options: { renderLayout?: ClipLayoutPreset; renderVariants?: boolean; layoutOverrides?: ClipLayoutOverrides } = {}
): Promise<ClipJob> {
  await loadJobs();
  const id = crypto.randomUUID().slice(0, 8);
  const renderLayout = options.renderLayout && options.renderLayout in CLIP_LAYOUTS ? options.renderLayout : DEFAULT_CLIP_LAYOUT;
  const job: ClipJob = {
    id,
    fileName: url,
    topic: topic || undefined,
    sourceUrl: url,
    renderLayout,
    renderVariants: Boolean(options.renderVariants),
    layoutOverrides: options.layoutOverrides,
    status: "queued",
    stage: "downloading",
    progress: 2,
    notices: [],
    createdAt: new Date().toISOString(),
    clips: []
  };
  jobs.set(id, job);
  await mkdir(workDir(id), { recursive: true });
  await mkdir(outputDir(id), { recursive: true });
  await persistJobs();

  // Run the pipeline without blocking the response; the client polls.
  void runPipeline(job, url).catch((error) => failJob(job, error));
  return job;
}

/**
 * The whole pipeline for a pasted VOD URL:
 *   1. Download just the audio (fast even for multi-hour streams).
 *   2. Read the FULL transcript and pick the best moments from anywhere in the
 *      stream (Claude), falling back to whole-stream energy analysis offline.
 *   3. Fetch each chosen range and render it as a 9:16 short — in parallel.
 */
async function runPipeline(job: ClipJob, url: string) {
  // 1. Read metadata, then grab the audio track for analysis.
  await update(job, { status: "processing", stage: "downloading", progress: 5 });
  const meta = await fetchVideoMeta(url);
  if (meta.title) await update(job, { fileName: meta.title });
  if (meta.durationSec && meta.durationSec < 20) {
    throw new Error("That VOD is shorter than 20 seconds — pick a longer stream to clip from.");
  }

  const audioPath = await downloadAudio(url, workDir(job.id), (pct) =>
    void update(job, { progress: 5 + Math.round((pct / 100) * 20) })
  );
  const durationSec = meta.durationSec || (await probeDuration(audioPath));
  await update(job, { durationSec: Math.round(durationSec) });

  // 2. Read the whole transcript and pick the best moments from across the
  //    entire stream. Captions double as the editor's source captions.
  await update(job, { stage: "analyzing", progress: 30 });
  let transcript: ClipJob["sourceCaptions"] = [];
  try {
    transcript = await fetchAutoCaptions(url, workDir(job.id));
    if (transcript.length > 0) {
      await update(job, {
        sourceCaptions: transcript,
        captionsFetchedAt: new Date().toISOString(),
        captionsError: undefined
      });
    }
  } catch (error) {
    await update(job, { captionsError: error instanceof Error ? error.message : String(error) });
  }

  await update(job, { stage: "selecting", progress: 42 });
  let candidates: ClipCandidate[] | null = null;
  if (transcript && transcript.length > 0) {
    candidates = await selectByTranscript(transcript, durationSec, job.topic);
  }

  if (!candidates || candidates.length === 0) {
    // Score moments from audio energy across the whole stream. We still pass the transcript (if any) so scoring
    // can read what is said, not just how loud it is.
    const [windows, silences] = await Promise.all([extractEnergy(audioPath), detectSilences(audioPath)]);
    candidates = selectCandidates(windows, silences, durationSec, transcript ?? []);
    if (!transcript || transcript.length === 0) {
      job.notices.push(
        "No transcript was available for this source — picked moments from whole-stream audio energy instead."
      );
    }
  }
  job.clips = candidates;
  await persistJobs();

  await renderClipIndexes(
    job,
    job.clips.map((_, index) => index)
  );

  // Optionally mirror the finished clips into a Google Drive-synced folder.
  // No API or sign-in: this just copies files into a local folder that Google
  // Drive for Desktop syncs (see CLIPS_DRIVE_DIR in .env). Off unless set.
  if (driveDir()) {
    const rendered = job.clips
      .filter((clip) => clip.file)
      .map((clip) => ({ sourcePath: path.join(outputDir(job.id), clip.file as string), fileName: clip.file as string }));
    if (rendered.length > 0) {
      try {
        const { folder, copied } = await copyClipsToDrive(job.fileName, rendered);
        job.driveFolder = folder;
        job.notices.push(`Copied ${copied} clip${copied === 1 ? "" : "s"} to your Google Drive folder: ${folder}`);
      } catch (error) {
        job.notices.push(
          `Could not copy clips to your Google Drive folder: ${error instanceof Error ? error.message : String(error)}.`
        );
      }
      await persistJobs();
    }
  }

  await update(job, { status: "done", stage: "finished", progress: 100 });
}

async function renderClipIndexes(job: ClipJob, indexes: number[]) {
  // Fetch each chosen range from the source and render a 9:16 short. These are
  // network- and CPU-bound, so keep concurrency modest to avoid source throttles.
  let completed = 0;
  const total = indexes.length;
  const renderOne = async (i: number) => {
    const clip = job.clips[i];
    const segPath = path.join(workDir(job.id), `seg-${String(i + 1).padStart(2, "0")}.mp4`);
    try {
      const produced = await downloadSection(job.sourceUrl, clip.start, clip.end, segPath);
      const baseName = `clip-${String(i + 1).padStart(2, "0")}`;
      const primaryLayout = job.renderLayout ?? DEFAULT_CLIP_LAYOUT;
      const layoutOverrides = job.layoutOverrides;
      const primaryName = `${baseName}.mp4`;
      await renderClipLayout(produced, path.join(outputDir(job.id), primaryName), true, primaryLayout, layoutOverrides);
      clip.file = primaryName;
      clip.layoutPreset = primaryLayout;
      clip.variants = [{ layoutPreset: primaryLayout, file: primaryName, label: CLIP_LAYOUTS[primaryLayout].label }];

      if (job.renderVariants) {
        const alternateLayouts = (Object.keys(CLIP_LAYOUTS) as ClipLayoutPreset[]).filter((layout) => layout !== primaryLayout);
        for (const layout of alternateLayouts) {
          const variantName = `${baseName}-${layout}.mp4`;
          await renderClipLayout(produced, path.join(outputDir(job.id), variantName), true, layout, layoutOverrides);
          clip.variants.push({ layoutPreset: layout, file: variantName, label: CLIP_LAYOUTS[layout].label });
        }
      }
      await unlink(produced).catch(() => undefined);
    } catch (error) {
      job.notices.push(
        `Clip ${i + 1} (${Math.round(clip.start)}s) could not be rendered: ${error instanceof Error ? error.message : String(error)}.`
      );
    }
    completed += 1;
    await update(job, { stage: "rendering", progress: 50 + Math.round((completed / total) * 48) });
  };

  await update(job, { stage: "rendering", progress: 50 });
  const concurrency = Math.min(2, total);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const listIndex = nextIndex++;
      if (listIndex >= total) break;
      await renderOne(indexes[listIndex]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  await update(job, { status: "done", stage: "finished", progress: 100 });
}
