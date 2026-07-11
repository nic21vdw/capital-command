import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectSilences } from "@/lib/clipping/analysis";
import { probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { transcribeMedia } from "@/lib/clipping/whisper";
import { DEFAULT_PACE, buildSegments, hookCaptions, planHook } from "@/lib/longform/plan";
import type { LongformPace, LongformProject } from "@/lib/longform/types";

const longformRoot = path.join(process.cwd(), "data", "longform");
const projectsFile = path.join(longformRoot, "projects.json");
let persistQueue = Promise.resolve();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientReplaceError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

// Project state lives on globalThis: in Next dev each route gets its own
// module graph, so plain module-level state would not be shared between the
// create route and the status routes.
type LongformGlobal = typeof globalThis & {
  __longformProjects?: Map<string, LongformProject>;
  __longformProjectsLoaded?: boolean;
};
const g = globalThis as LongformGlobal;
const projects = (g.__longformProjects ??= new Map<string, LongformProject>());

async function loadProjects() {
  if (g.__longformProjectsLoaded) return;
  g.__longformProjectsLoaded = true;
  try {
    let raw = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        raw = await readFile(projectsFile, "utf8");
        JSON.parse(raw);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        if (attempt === 2) throw error;
        await wait(40);
      }
    }
    for (const project of JSON.parse(raw) as LongformProject[]) {
      // Projects saved before timeline images existed have no overlays field.
      project.overlays ??= [];
      // Projects saved before the audio track existed have no clips array, and
      // may carry a legacy single background track — migrate it into one clip
      // spanning the whole edit so it keeps playing and stays editable.
      migrateMusic(project);
      // Anything mid-flight when the server stopped can't resume.
      if (project.status === "processing") {
        project.status = "error";
        project.error = "The server restarted while this video was being analyzed. Upload it again or retry.";
      }
      for (const record of project.exports) {
        if (record.status === "processing") {
          record.status = "error";
          record.error = "The server restarted during this export. Export again.";
        }
      }
      projects.set(project.id, project);
    }
  } catch {
    // First run — no projects file yet.
  }
}

async function persistProjects() {
  const write = async () => {
    await mkdir(longformRoot, { recursive: true });
    const list = [...projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    const payload = JSON.stringify(list, null, 2);
    const tmpPath = `${projectsFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, payload, "utf8");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(tmpPath, projectsFile);
        return;
      } catch (error) {
        if (!isTransientReplaceError(error) || attempt === 4) {
          if (isTransientReplaceError(error)) {
            await writeFile(projectsFile, payload, "utf8");
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

/**
 * Brings a project's `music` up to the current clip-based shape. Older saves
 * had a single looped background track (`trackId` + `volume`); it becomes one
 * full-length audio clip so the timeline audio track can edit it like any
 * other placed clip.
 */
function migrateMusic(project: LongformProject) {
  const music = (project.music ??= { enabled: false, clips: [], videoVolume: 1, masterVolume: 1 });
  music.clips ??= [];
  music.videoVolume ??= 1;
  music.masterVolume ??= 1;
  if (music.trackId && music.clips.length === 0) {
    music.clips.push({
      id: crypto.randomUUID().slice(0, 8),
      trackId: music.trackId,
      fileName: "Background music",
      start: 0,
      duration: Math.max(1, project.durationSec || 60),
      volume: music.volume ?? 0.12
    });
  }
  music.trackId = undefined;
}

export function projectWorkDir(projectId: string) {
  return path.join(longformRoot, "work", projectId);
}

export function projectOutputDir(projectId: string) {
  return path.join(longformRoot, "outputs", projectId);
}

export async function listProjects(): Promise<LongformProject[]> {
  await loadProjects();
  return [...projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(id: string): Promise<LongformProject | undefined> {
  await loadProjects();
  return projects.get(id);
}

export async function deleteProject(id: string) {
  await loadProjects();
  projects.delete(id);
  await rm(projectWorkDir(id), { recursive: true, force: true });
  await rm(projectOutputDir(id), { recursive: true, force: true });
  await persistProjects();
}

export async function updateProject(id: string, patch: Partial<LongformProject>): Promise<LongformProject | undefined> {
  await loadProjects();
  const project = projects.get(id);
  if (!project) return undefined;
  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  await persistProjects();
  return project;
}

/** Internal update used by the pipeline; keeps updatedAt fresh. */
async function update(project: LongformProject, patch: Partial<LongformProject>) {
  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  await persistProjects();
}

async function failProject(project: LongformProject, error: unknown) {
  await update(project, { status: "error", error: error instanceof Error ? error.message : String(error) });
}

/**
 * Creates a long-form project from a previously uploaded source and starts
 * the analysis pipeline (transcribe → find dead space → plan the hook and
 * cuts) without blocking the response; the client polls.
 */
export async function createProject(sourceId: string, name?: string): Promise<LongformProject> {
  await loadProjects();
  const meta = await readSourceMeta(sourceId);
  if (!meta) throw new Error("That uploaded video could not be found. Upload it again.");
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const project: LongformProject = {
    id,
    name: (name ?? meta.fileName).replace(/\.[a-z0-9]+$/i, "") || meta.fileName,
    sourceId,
    fileName: meta.fileName,
    status: "processing",
    stage: "probing",
    progress: 2,
    notices: [],
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    hasAudio: meta.hasAudio,
    transcript: [],
    silences: [],
    segments: [],
    hook: planHook([], meta.durationSec || 0),
    overlays: [],
    music: { enabled: false, clips: [], videoVolume: 1, masterVolume: 1 },
    pace: { ...DEFAULT_PACE },
    exports: [],
    createdAt: now,
    updatedAt: now
  };
  projects.set(id, project);
  await mkdir(projectWorkDir(id), { recursive: true });
  await mkdir(projectOutputDir(id), { recursive: true });
  await persistProjects();

  void runAnalysis(project).catch((error) => failProject(project, error));
  return project;
}

/** Re-runs the analysis pipeline on an existing project (e.g. after an error). */
export async function retryAnalysis(id: string): Promise<LongformProject | undefined> {
  await loadProjects();
  const project = projects.get(id);
  if (!project) return undefined;
  if (project.status === "processing") throw new Error("This video is already being analyzed.");
  await update(project, { status: "processing", stage: "probing", progress: 2, error: undefined });
  void runAnalysis(project).catch((error) => failProject(project, error));
  return project;
}

/**
 * Rebuilds the cut plan with new pace settings, keeping the hook as-is.
 * Manual segment toggles are reset — the plan is regenerated from the cached
 * silences, so no re-analysis of the media is needed.
 */
export async function replanProject(id: string, pace: LongformPace): Promise<LongformProject | undefined> {
  await loadProjects();
  const project = projects.get(id);
  if (!project) return undefined;
  if (project.status !== "ready") throw new Error("This project is still processing.");
  const segments = buildSegments(project.durationSec, project.silences, pace);
  await update(project, { pace, segments });
  return project;
}

// Sources longer than this (stream VODs, multi-hour recordings) only get the
// opening minutes transcribed: the transcript exists to caption the hook,
// which covers at most the first 60 seconds, and whisper on a full multi-hour
// stream would take hours. Silence detection always runs on the full audio,
// so the cut plan covers the whole recording either way.
const FULL_TRANSCRIBE_MAX_SEC = 45 * 60;
const LONG_SOURCE_TRANSCRIBE_SEC = 5 * 60;

/**
 * The analysis pipeline: probe the source, transcribe it locally with Whisper
 * (word-level timing drives the hook captions), detect the silences, then
 * plan the hook and the dead-space cuts. A failed transcription degrades
 * gracefully — the cut plan still works from silence detection alone.
 */
async function runAnalysis(project: LongformProject) {
  await update(project, { status: "processing", stage: "probing", progress: 4, error: undefined, notices: [] });
  const meta = await readSourceMeta(project.sourceId);
  if (!meta) throw new Error("The uploaded source file for this project is gone. Upload the video again.");
  const srcPath = sourceFilePath(meta);
  const durationSec = meta.durationSec || (await probeDuration(srcPath));
  if (durationSec < 15) {
    throw new Error("That video is shorter than 15 seconds — the Long-Form Editor is built for full recordings.");
  }
  await update(project, {
    durationSec,
    width: meta.width,
    height: meta.height,
    hasAudio: meta.hasAudio,
    progress: 8
  });

  // Everything downstream (transcription + silence detection) runs on a small
  // mono audio extract, which is far faster than decoding the full video.
  let audioPath: string | null = null;
  if (meta.hasAudio) {
    audioPath = path.join(projectWorkDir(project.id), "source-audio.mp3");
    await runFfmpeg(["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath]);
  }

  await update(project, { stage: "transcribing", progress: 20 });
  let transcript: LongformProject["transcript"] = [];
  if (audioPath) {
    try {
      const isLongSource = durationSec > FULL_TRANSCRIBE_MAX_SEC;
      transcript = await transcribeMedia(
        audioPath,
        projectWorkDir(project.id),
        isLongSource ? { maxSeconds: LONG_SOURCE_TRANSCRIBE_SEC } : {}
      );
      if (isLongSource) {
        project.notices.push(
          "This is a long recording, so only the opening minutes were transcribed for the hook captions. Dead-space cuts still cover the entire video."
        );
      }
      await update(project, { transcript, transcriptError: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      project.notices.push(`Automatic captions unavailable: ${message}`);
      await update(project, { transcriptError: message });
    }
  } else {
    project.notices.push("This video has no audio track — there is no dead space to cut and no hook captions.");
  }

  await update(project, { stage: "analyzing", progress: 72 });
  let silences: LongformProject["silences"] = [];
  if (audioPath) {
    silences = await detectSilences(audioPath);
  }

  await update(project, { stage: "planning", progress: 90 });
  const segments = buildSegments(durationSec, silences, project.pace);
  const hook = planHook(transcript, durationSec);
  await update(project, {
    silences,
    segments,
    hook,
    transcript,
    status: "ready",
    stage: "ready",
    progress: 100
  });
}

/** Recomputes the hook captions from the stored transcript for a new hook end. */
export function rebuildHookCaptions(project: LongformProject, hookEnd: number) {
  return hookCaptions(project.transcript, hookEnd);
}
