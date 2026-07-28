import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { saveTrackFromUrl } from "@/lib/longform/music";
import { writeSongBrief, type SongBrief } from "@/lib/music/brief";
import { checkSongJob, submitSongJob, sunoConfigured } from "@/lib/music/suno";

/**
 * The generated-song ledger. A Suno job takes minutes, so the browser starts
 * one and then polls; this file is what makes that polling safe to repeat.
 *
 * Advancing a job is idempotent behind two guards: the ledger records the
 * track ids a finished task already imported, and an in-flight map keyed by
 * task id keeps two overlapping polls from downloading the same song twice.
 * Both live in ONE process — like the pipeline runs and the Threads queue,
 * anything outside the Next server must go through the HTTP API rather than
 * importing this module and getting a second copy of the map.
 */

const jobsFile = path.join(process.cwd(), "data", "longform", "music", "suno-jobs.json");

export type SunoJobRecord = {
  taskId: string;
  status: "pending" | "complete" | "failed";
  idea: string;
  brief: SongBrief;
  instrumental: boolean;
  /** Library tracks imported from this task — empty until it finishes. */
  trackIds: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type Globals = typeof globalThis & { __sunoImports?: Map<string, Promise<SunoJobRecord>> };
const inFlight: Map<string, Promise<SunoJobRecord>> = ((globalThis as Globals).__sunoImports ??= new Map());

let writeQueue = Promise.resolve();

async function readJobs(): Promise<SunoJobRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(jobsFile, "utf8"));
    return Array.isArray(parsed) ? (parsed as SunoJobRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: SunoJobRecord[]) {
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

async function saveJob(job: SunoJobRecord): Promise<SunoJobRecord> {
  const jobs = await readJobs();
  const next = { ...job, updatedAt: new Date().toISOString() };
  const index = jobs.findIndex((entry) => entry.taskId === next.taskId);
  if (index === -1) jobs.push(next);
  else jobs[index] = next;
  await writeJobs(jobs.slice(-50));
  return next;
}

export async function getSongJob(taskId: string): Promise<SunoJobRecord | null> {
  const jobs = await readJobs();
  return jobs.find((job) => job.taskId === taskId) ?? null;
}

export async function listSongJobs(): Promise<SunoJobRecord[]> {
  const jobs = await readJobs();
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Filesystem-safe file name for a finished take. */
function songFileName(title: string, take: number): string {
  const base = title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "suno-song";
  return take === 0 ? `${base}.mp3` : `${base} (take ${take + 1}).mp3`;
}

/**
 * Writes the brief (unless one is supplied) and submits it. Returns the ledger
 * record so the caller can start polling immediately. Never throws.
 */
export async function startSong(input: {
  idea: string;
  brief?: SongBrief;
  instrumental?: boolean;
}): Promise<{ job: SunoJobRecord | null; error: string | null }> {
  if (!sunoConfigured()) {
    return { job: null, error: "SUNO_API_KEY is not set — add it to .env to generate songs." };
  }
  const idea = input.idea.trim();
  if (!idea && !input.brief) return { job: null, error: "Describe the song you want." };

  const brief = input.brief ?? (await writeSongBrief(idea));
  const instrumental = input.instrumental ?? true;
  const { taskId, error } = await submitSongJob({
    prompt: brief.prompt,
    style: brief.style,
    title: brief.title,
    instrumental
  });
  if (!taskId) return { job: null, error: error ?? "Suno did not start that song." };

  const now = new Date().toISOString();
  const job = await saveJob({
    taskId,
    status: "pending",
    idea: idea || brief.prompt,
    brief,
    instrumental,
    trackIds: [],
    createdAt: now,
    updatedAt: now
  });
  return { job, error: null };
}

async function importFinishedSongs(job: SunoJobRecord): Promise<SunoJobRecord> {
  const state = await checkSongJob(job.taskId);
  if (state.status === "pending") return job;
  if (state.status === "failed") {
    return saveJob({ ...job, status: "failed", error: state.error });
  }

  const trackIds: string[] = [];
  for (const [index, song] of state.songs.entries()) {
    try {
      const track = await saveTrackFromUrl(song.audioUrl, songFileName(job.brief.title || song.title, index), {
        provider: "suno",
        taskId: job.taskId,
        songId: song.id,
        prompt: job.brief.prompt,
        style: job.brief.style
      });
      trackIds.push(track.id);
    } catch {
      // One take failing to download shouldn't lose the other.
    }
  }
  if (trackIds.length === 0) {
    return saveJob({ ...job, status: "failed", error: "The finished song could not be downloaded." });
  }
  return saveJob({ ...job, status: "complete", trackIds, error: undefined });
}

/**
 * Polls a job and, once Suno is done, imports every take into the library.
 * Safe to call as often as the browser likes: a job that already recorded its
 * track ids is returned as-is, and a poll that arrives mid-import joins the
 * import already running instead of starting a second one.
 */
export async function advanceSong(taskId: string): Promise<SunoJobRecord | null> {
  const job = await getSongJob(taskId);
  if (!job) return null;
  if (job.status !== "pending") return job;

  const running = inFlight.get(taskId);
  if (running) return running;

  const work = importFinishedSongs(job).finally(() => inFlight.delete(taskId));
  inFlight.set(taskId, work);
  return work;
}
