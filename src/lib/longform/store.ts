import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { detectSilences } from "@/lib/clipping/analysis";
import { probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { listJobs } from "@/lib/clipping/jobs";
import { readSourceMeta, saveSourceFromUrl, sourceFilePath } from "@/lib/clipping/sources";
import { readSourceTranscript, transcribeSource } from "@/lib/clipping/source-transcript";
import { DEFAULT_PACE, buildSegments, hookCaptions, planCaptions, planHook } from "@/lib/longform/plan";
import { DEFAULT_TOPIC_OPTIONS, buildTopics, type TopicPlanOptions } from "@/lib/longform/topics";
import type { LongformPace, LongformProject } from "@/lib/longform/types";
import { defaultSfxSettings } from "@/lib/sfx/types";
import type { CaptionSegment } from "@/types/domain";

const longformRoot = dataPath("longform");
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
      // Projects saved before whole-video captions existed get them seeded
      // from the stored transcript, switched off so exports don't change.
      project.captions ??= planCaptions(project.transcript ?? []);
      // Projects saved before the hook could be moved off the opening default
      // to starting at 0 (the recording's start), matching their old behavior.
      if (project.hook) project.hook.start ??= 0;
      // Projects saved before the audio track existed have no clips array, and
      // may carry a legacy single background track — migrate it into one clip
      // spanning the whole edit so it keeps playing and stays editable.
      migrateMusic(project);
      // Projects saved before viral sound effects existed default to off.
      project.sfx ??= defaultSfxSettings();
      dropShortRecordingTopics(project);
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

/**
 * Segments planned before the planner had a length floor. Every app demo in
 * the library came back split into one or two "segments" — halves of a video
 * rather than videos — and they now crowd the editor's segment picker. Drop
 * them, unless one was actually rendered: a finished file is a real thing and
 * is left alone.
 */
function dropShortRecordingTopics(project: LongformProject) {
  if (!project.topics?.length) return;
  if (project.durationSec >= DEFAULT_TOPIC_OPTIONS.minTotalSec) return;
  const rendered = project.exports.some((record) => record.topicId && record.status === "done" && record.file);
  if (rendered) return;
  project.topics = [];
  project.topicsNote = noSegmentsNote(project.durationSec, false);
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
  const project = await newProjectRecord({
    name: (name ?? meta.fileName).replace(/\.[a-z0-9]+$/i, "") || meta.fileName,
    sourceId,
    fileName: meta.fileName,
    stage: "probing",
    progress: 2,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    hasAudio: meta.hasAudio
  });

  void runAnalysis(project).catch((error) => failProject(project, error));
  return project;
}

/**
 * Creates a long-form project straight from a YouTube (or other yt-dlp) link:
 * the full video is downloaded to a source in the background, then the same
 * analysis pipeline runs on it. Returns immediately with a project stuck in the
 * `downloading` stage so the client can poll for progress.
 */
export async function createProjectFromUrl(url: string, name?: string): Promise<LongformProject> {
  await loadProjects();
  const project = await newProjectRecord({
    name: (name ?? "").trim() || "YouTube video",
    sourceId: "",
    fileName: url,
    stage: "downloading",
    progress: 2,
    durationSec: 0,
    width: 0,
    height: 0,
    hasAudio: true
  });

  void downloadAndAnalyze(project, url, name).catch((error) => failProject(project, error));
  return project;
}

/** Builds a fresh project record, registers it, and creates its work dirs. */
async function newProjectRecord(fields: {
  name: string;
  sourceId: string;
  fileName: string;
  stage: LongformProject["stage"];
  progress: number;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}): Promise<LongformProject> {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const project: LongformProject = {
    id,
    name: fields.name,
    sourceId: fields.sourceId,
    fileName: fields.fileName,
    status: "processing",
    stage: fields.stage,
    progress: fields.progress,
    notices: [],
    durationSec: fields.durationSec,
    width: fields.width,
    height: fields.height,
    hasAudio: fields.hasAudio,
    transcript: [],
    silences: [],
    segments: [],
    hook: planHook([], fields.durationSec || 0),
    captions: planCaptions([]),
    overlays: [],
    music: { enabled: false, clips: [], videoVolume: 1, masterVolume: 1 },
    sfx: defaultSfxSettings(),
    layout: "wide",
    pace: { ...DEFAULT_PACE },
    exports: [],
    createdAt: now,
    updatedAt: now
  };
  projects.set(id, project);
  await mkdir(projectWorkDir(id), { recursive: true });
  await mkdir(projectOutputDir(id), { recursive: true });
  await persistProjects();
  return project;
}

/**
 * Downloads the full source video for a URL-based project, wires up the source,
 * then hands off to the normal analysis pipeline. Download progress drives the
 * project's progress bar while the `downloading` stage is showing.
 */
async function downloadAndAnalyze(project: LongformProject, url: string, name?: string) {
  const meta = await saveSourceFromUrl(url, (pct) => {
    // Throttle persistence to whole-percent steps so a chatty progress stream
    // doesn't hammer the projects file.
    const next = Math.max(2, Math.min(99, Math.round(pct)));
    if (next !== project.progress) void update(project, { progress: next });
  });
  await update(project, {
    sourceId: meta.id,
    fileName: meta.fileName,
    // Keep an explicit name the user typed; otherwise adopt the video's title.
    name: (name ?? "").trim() || meta.fileName.replace(/\.[a-z0-9]+$/i, "") || project.name,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    hasAudio: meta.hasAudio
  });
  await runAnalysis(project);
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

// ----- Topic segments -----

/** How much of the recording a transcript must span to plan topics from it. */
const TOPIC_COVERAGE = 0.8;

function transcriptCoverage(transcript: CaptionSegment[], durationSec: number): number {
  if (transcript.length === 0 || durationSec <= 0) return 0;
  const end = transcript[transcript.length - 1].end;
  return Math.min(1, end / durationSec);
}

/**
 * The best whole-recording transcript available for this source. The project's
 * own transcript is used when it covers the video; long recordings only get
 * their opening minutes transcribed for the hook, so those fall back to the
 * full transcript the clips subsystem produced from the SAME source (the
 * Stream Pipeline runs both, so a stream normally has one). Returns null when
 * nothing covers the recording — topics would otherwise all land in the first
 * few minutes.
 */
async function fullSourceTranscript(project: LongformProject): Promise<CaptionSegment[] | null> {
  if (transcriptCoverage(project.transcript ?? [], project.durationSec) >= TOPIC_COVERAGE) {
    return project.transcript;
  }
  if (!project.sourceId) return null;
  const shared = await readSourceTranscript(project.sourceId);
  if (shared && transcriptCoverage(shared, project.durationSec) >= TOPIC_COVERAGE) return shared;
  try {
    const jobs = await listJobs();
    for (const job of jobs) {
      if (job.sourceId !== project.sourceId) continue;
      const captions = job.sourceCaptions ?? [];
      if (transcriptCoverage(captions, project.durationSec) >= TOPIC_COVERAGE) return captions;
    }
  } catch {
    // The clips store is unavailable — fall through to the note below.
  }
  return null;
}

/**
 * Why a recording came back with no segments. A short one has nothing wrong
 * with it — an eight-minute app demo is one upload, and saying "no distinct
 * subjects" about it reads like a failure when it is the intended answer.
 */
function noSegmentsNote(durationSec: number, requested: boolean): string {
  if (!requested && durationSec > 0 && durationSec < DEFAULT_TOPIC_OPTIONS.minTotalSec) {
    return `At ${Math.max(1, Math.round(durationSec / 60))} minutes this is one video, not a stream — segments are only cut from recordings over ${Math.round(DEFAULT_TOPIC_OPTIONS.minTotalSec / 60)} minutes. Post it whole from the Export tab.`;
  }
  return "The transcript did not split into distinct subjects — this recording reads as one continuous topic.";
}

const NO_TRANSCRIPT_NOTE =
  "Topic segments need a transcript of the whole recording. This one is long enough that only its opening minutes were transcribed for the hook — run the same source through the Stream Pipeline (or the Clip Generator), which transcribes it end to end, and the segments appear here.";

/**
 * Reads the transcript and stores the stream's topic segments on the project.
 * Safe to call repeatedly: it simply replans. Leaves `topics` untouched (and
 * records why) when no whole-recording transcript exists yet, so a later call
 * can still succeed once the clips subsystem has transcribed the source.
 */
export async function planProjectTopics(
  id: string,
  options?: TopicPlanOptions
): Promise<LongformProject | undefined> {
  // Analysis fires this the moment a project turns ready, and the Stream
  // Pipeline fires it again as soon as the full transcript lands. Both can be
  // in flight at once, and `buildTopics` is a model call — share the first.
  const running = topicPlans.get(id);
  if (running) return running;
  const plan = planTopicsNow(id, options).finally(() => topicPlans.delete(id));
  topicPlans.set(id, plan);
  return plan;
}

const topicPlans = new Map<string, Promise<LongformProject | undefined>>();

async function planTopicsNow(
  id: string,
  options?: TopicPlanOptions
): Promise<LongformProject | undefined> {
  await loadProjects();
  const project = projects.get(id);
  if (!project) return undefined;
  const transcript = await fullSourceTranscript(project);
  if (!transcript) {
    await update(project, { topicsNote: NO_TRANSCRIPT_NOTE });
    return project;
  }
  const topics = await buildTopics({ streamName: project.name, transcript, options });
  // Replanning moves the windows, so old per-segment exports no longer line up
  // with the new ids; the finished files stay in the export list either way.
  await update(project, {
    topics,
    topicsNote: topics.length ? undefined : noSegmentsNote(project.durationSec, options?.minTotalSec === 0)
  });
  return project;
}

/** Marks a topic segment with the export it was last rendered as. */
export async function setTopicExport(projectId: string, topicId: string, exportId: string) {
  await loadProjects();
  const project = projects.get(projectId);
  if (!project?.topics) return;
  const topics = project.topics.map((topic) => (topic.id === topicId ? { ...topic, exportId } : topic));
  await update(project, { topics });
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
      transcript = await transcribeSource(
        project.sourceId,
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
  // Reseed the whole-video captions from the fresh transcript, keeping the
  // user's toggle and styling if this is a re-analysis.
  const captions = {
    ...planCaptions(transcript),
    ...(project.captions
      ? {
          enabled: project.captions.enabled,
          highlightCurrentWord: project.captions.highlightCurrentWord,
          style: project.captions.style
        }
      : {})
  };
  await update(project, {
    silences,
    segments,
    hook,
    captions,
    transcript,
    // A re-analysis re-reads the audio, so any earlier topic plan is stale.
    topics: undefined,
    topicsNote: undefined,
    status: "ready",
    stage: "ready",
    progress: 100
  });

  // Topic segments are planned from the finished transcript (and can involve an
  // AI titling call), so they run after the project is already usable — the
  // plan lands on the next poll rather than holding the editor closed.
  void planProjectTopics(project.id).catch(() => undefined);
}

/** Recomputes the hook captions from the stored transcript for a new hook window. */
export function rebuildHookCaptions(project: LongformProject, hookStart: number, hookEnd: number) {
  return hookCaptions(project.transcript, hookStart, hookEnd);
}
