import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectSilences, extractEnergy, selectCandidates } from "@/lib/clipping/analysis";
import { downloadAudio, downloadSection, fetchVideoMeta } from "@/lib/clipping/download";
import { probeDuration } from "@/lib/clipping/ffmpeg";
import { renderVertical } from "@/lib/clipping/render";
import type { ClipJob } from "@/lib/clipping/types";

const clipsRoot = path.join(process.cwd(), "data", "clips");
const jobsFile = path.join(clipsRoot, "jobs.json");

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
    const raw = await readFile(jobsFile, "utf8");
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

async function update(job: ClipJob, patch: Partial<ClipJob>) {
  Object.assign(job, patch);
  await persistJobs();
}

async function failJob(job: ClipJob, error: unknown) {
  await update(job, { status: "error", error: error instanceof Error ? error.message : String(error) });
}

export async function createJobFromUrl(url: string, topic: string | undefined): Promise<ClipJob> {
  await loadJobs();
  const id = crypto.randomUUID().slice(0, 8);
  const job: ClipJob = {
    id,
    fileName: url,
    topic: topic || undefined,
    sourceUrl: url,
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
 *   2. Score the loudest, best-paced moments offline.
 *   3. Fetch each chosen range and render it as a 9:16 short.
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

  // 2. Pick the strongest moments from audio energy (fully offline).
  await update(job, { stage: "analyzing", progress: 32 });
  const [windows, silences] = await Promise.all([extractEnergy(audioPath), detectSilences(audioPath)]);

  await update(job, { stage: "selecting", progress: 46 });
  job.clips = selectCandidates(windows, silences, durationSec);
  await persistJobs();

  // 3. Fetch each chosen range from the source and render a 9:16 short.
  for (let i = 0; i < job.clips.length; i++) {
    const clip = job.clips[i];
    await update(job, { stage: "rendering", progress: 50 + Math.round((i / job.clips.length) * 48) });
    const segPath = path.join(workDir(job.id), `seg-${String(i + 1).padStart(2, "0")}.mp4`);
    try {
      const produced = await downloadSection(url, clip.start, clip.end, segPath);
      const verticalName = `clip-${String(i + 1).padStart(2, "0")}.mp4`;
      await renderVertical(produced, path.join(outputDir(job.id), verticalName), true);
      clip.file = verticalName;
      await unlink(produced).catch(() => undefined);
    } catch (error) {
      job.notices.push(
        `Clip ${i + 1} (${Math.round(clip.start)}s) could not be rendered: ${error instanceof Error ? error.message : String(error)}.`
      );
    }
    await persistJobs();
  }

  await update(job, { status: "done", stage: "finished", progress: 100 });
}
