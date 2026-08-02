import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { saveTrackFromUrl } from "@/lib/longform/music";
import { heuristicSongBrief } from "@/lib/music/brief";
import { checkFalJob, falConfigured, submitFalJob } from "@/lib/music/fal";
import { buildModelInput, getMusicModel, readModelAudio, type MusicModel, type StudioRequest } from "@/lib/music/models";

/**
 * The generation ledger. A model takes anywhere from twenty seconds to a few
 * minutes, so the studio starts a job and then polls; this file is what makes
 * that polling safe to repeat.
 *
 * Advancing a job is idempotent behind two guards: the ledger records the
 * track ids a finished request already imported, and an in-flight map keyed by
 * request id keeps two overlapping polls from downloading the same take twice.
 * Both live in ONE process — like the pipeline runs and the Threads queue,
 * anything outside the Next server must go through the HTTP API rather than
 * importing this module and getting a second copy of the map.
 */

const jobsFile = dataPath("longform", "music", "jobs.json");

export type MusicJobRecord = {
  requestId: string;
  modelId: string;
  modelLabel: string;
  status: "pending" | "complete" | "failed";
  title: string;
  prompt: string;
  instrumental: boolean;
  durationSec?: number;
  /** Poll URLs fal handed back on submit; absent on jobs recorded before them. */
  statusUrl?: string;
  responseUrl?: string;
  /** Library tracks imported from this request — empty until it finishes. */
  trackIds: string[];
  queuePosition?: number | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type Globals = typeof globalThis & { __musicImports?: Map<string, Promise<MusicJobRecord>> };
const inFlight: Map<string, Promise<MusicJobRecord>> = ((globalThis as Globals).__musicImports ??= new Map());

let writeQueue = Promise.resolve();

async function readJobs(): Promise<MusicJobRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(jobsFile, "utf8"));
    return Array.isArray(parsed) ? (parsed as MusicJobRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: MusicJobRecord[]) {
  const write = async () => {
    await mkdir(path.dirname(jobsFile), { recursive: true });
    const tmpPath = `${jobsFile}.${process.pid}.tmp`;
    await writeFile(tmpPath, JSON.stringify(jobs, null, 2), "utf8");
    try {
      await rename(tmpPath, jobsFile);
    } catch {
      await writeFile(jobsFile, JSON.stringify(jobs, null, 2), "utf8");
      await unlink(tmpPath).catch(() => undefined);
    }
  };
  writeQueue = writeQueue.then(write, write);
  await writeQueue;
}

async function saveJob(job: MusicJobRecord): Promise<MusicJobRecord> {
  const jobs = await readJobs();
  const next = { ...job, updatedAt: new Date().toISOString() };
  const index = jobs.findIndex((entry) => entry.requestId === next.requestId);
  if (index === -1) jobs.push(next);
  else jobs[index] = next;
  await writeJobs(jobs.slice(-60));
  return next;
}

export async function getMusicJob(requestId: string): Promise<MusicJobRecord | null> {
  const jobs = await readJobs();
  return jobs.find((job) => job.requestId === requestId) ?? null;
}

export async function listMusicJobs(): Promise<MusicJobRecord[]> {
  const jobs = await readJobs();
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Filesystem-safe file name for a finished take. */
export function trackFileName(title: string, take: number, extension: string): string {
  const base = title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "generated-track";
  return take === 0 ? `${base}${extension}` : `${base} (take ${take + 1})${extension}`;
}

/** Submits a studio request. Returns the ledger record so polling can start. Never throws. */
export async function startMusicJob(
  request: StudioRequest & { title?: string }
): Promise<{ job: MusicJobRecord | null; error: string | null }> {
  if (!falConfigured()) {
    return { job: null, error: "FAL_KEY is not set — add it to .env to generate music." };
  }
  const model = getMusicModel(request.modelId);
  if (!model) return { job: null, error: "Unknown model." };
  if (!request.prompt.trim()) return { job: null, error: "Describe the music you want." };

  const { requestId, statusUrl, responseUrl, error } = await submitFalJob(
    model.endpointId,
    buildModelInput(model, request)
  );
  if (!requestId) return { job: null, error: error ?? "fal did not start that generation." };

  const now = new Date().toISOString();
  const job = await saveJob({
    requestId,
    modelId: model.id,
    modelLabel: model.label,
    status: "pending",
    statusUrl,
    responseUrl,
    title: request.title?.trim() || heuristicSongBrief(request.prompt).title,
    prompt: request.prompt.trim(),
    instrumental: request.instrumental,
    durationSec: request.durationSec,
    trackIds: [],
    createdAt: now,
    updatedAt: now
  });
  return { job, error: null };
}

async function importFinishedTakes(job: MusicJobRecord, model: MusicModel): Promise<MusicJobRecord> {
  const state = await checkFalJob(model.endpointId, job.requestId, {
    statusUrl: job.statusUrl,
    responseUrl: job.responseUrl
  });
  if (state.status === "pending") {
    return job.queuePosition === state.queuePosition ? job : saveJob({ ...job, queuePosition: state.queuePosition });
  }
  if (state.status === "failed") return saveJob({ ...job, status: "failed", error: state.error });

  const takes = readModelAudio(model, state.output);
  if (takes.length === 0) {
    return saveJob({ ...job, status: "failed", error: `${model.label} finished but returned no audio.` });
  }

  const trackIds: string[] = [];
  for (const [index, take] of takes.entries()) {
    try {
      const track = await saveTrackFromUrl(take.url, trackFileName(job.title, index, model.extension), {
        provider: "fal",
        modelId: model.id,
        modelLabel: model.label,
        requestId: job.requestId,
        prompt: job.prompt,
        instrumental: job.instrumental
      });
      trackIds.push(track.id);
    } catch {
      // One take failing to download shouldn't lose the others.
    }
  }
  if (trackIds.length === 0) {
    return saveJob({ ...job, status: "failed", error: "The finished audio could not be downloaded." });
  }
  return saveJob({ ...job, status: "complete", trackIds, error: undefined });
}

/**
 * Polls a job and, once the model is done, imports every take into the shared
 * music library. Safe to call as often as the studio likes: a job that already
 * recorded its track ids is returned as-is, and a poll that arrives mid-import
 * joins the import already running instead of starting a second one.
 */
export async function advanceMusicJob(requestId: string): Promise<MusicJobRecord | null> {
  const job = await getMusicJob(requestId);
  if (!job) return null;
  if (job.status !== "pending") return job;
  const model = getMusicModel(job.modelId);
  if (!model) return saveJob({ ...job, status: "failed", error: "That model is no longer available." });

  const running = inFlight.get(requestId);
  if (running) return running;

  const work = importFinishedTakes(job, model).finally(() => inFlight.delete(requestId));
  inFlight.set(requestId, work);
  return work;
}
