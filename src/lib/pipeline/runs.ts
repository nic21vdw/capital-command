import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createJobFromUpload, getJob } from "@/lib/clipping/jobs";
import { readSourceMeta, saveSourceFromUrl } from "@/lib/clipping/sources";
import type { ClipJob } from "@/lib/clipping/types";
import { startLongformExport } from "@/lib/longform/render";
import { createProject, getProject, planProjectTopics, projectOutputDir, updateProject } from "@/lib/longform/store";
import type { LongformProject } from "@/lib/longform/types";
import { generatePipelinePosts } from "@/lib/pipeline/posts";
import {
  MIN_SPEECH_WORDS,
  realisticImagePrompt,
  speechWordCount,
  visualMomentFromClips
} from "@/lib/pipeline/visual-brief";
import type {
  PipelineRun,
  PipelineRunOverview,
  PipelineStage,
  PipelineStageStatus
} from "@/lib/pipeline/types";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { framesForSource } from "@/lib/carousels/videoFrames";
import { DEFAULT_SLIDE_COUNT, generateCarousel } from "@/lib/studio/carousel";

// A run is a thin coordination record over the existing subsystems — the
// media itself lives with the long-form project, the clip job, and the shared
// source. Same persistence pattern as those stores: a globalThis map (Next
// dev gives each route its own module graph) flushed to one JSON file.

const pipelineRoot = dataPath("pipeline");
const runsFile = path.join(pipelineRoot, "runs.json");
const MAX_RUNS = 30;
let persistQueue = Promise.resolve();

type PipelineGlobal = typeof globalThis & {
  __pipelineRuns?: Map<string, PipelineRun>;
  __pipelineRunsLoaded?: boolean;
  /** `${runId}:${step}` keys for advance steps currently in flight. */
  __pipelineInflight?: Set<string>;
};
const g = globalThis as PipelineGlobal;
const runs = (g.__pipelineRuns ??= new Map<string, PipelineRun>());
const inflight = (g.__pipelineInflight ??= new Set<string>());

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the runs file, tolerating a read that lands mid-write. Returns null
 * when the file is there but never parsed cleanly, so the caller can leave the
 * store unloaded and try again on the next request instead of reporting an
 * empty pipeline (or throwing a 500 out of `GET /api/pipeline`).
 */
async function readRunsFile(): Promise<PipelineRun[] | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let raw: string;
    try {
      raw = await readFile(runsFile, "utf8");
    } catch {
      return []; // First run — no file yet.
    }
    try {
      const parsed = JSON.parse(raw) as PipelineRun[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      await delay(40 * (attempt + 1));
    }
  }
  return null;
}

async function loadRuns() {
  if (g.__pipelineRunsLoaded) return;
  const stored = await readRunsFile();
  // Leaving `__pipelineRunsLoaded` false on a torn read is the point: marking
  // it loaded would strand the server with an empty run list until restart.
  if (stored === null) return;
  g.__pipelineRunsLoaded = true;
  {
    for (const run of stored) {
      // A download that was mid-flight when the server stopped can't resume.
      // Everything after ingest is re-driven by advanceRun, so `running`
      // survives a restart (the underlying stores mark their own casualties).
      if (run.status === "ingesting") {
        run.status = "error";
        run.error = "The server restarted while the stream was downloading. Start the run again.";
      }
      runs.set(run.id, run);
    }
  }
}

async function persistRuns() {
  const write = async () => {
    await mkdir(pipelineRoot, { recursive: true });
    const list = [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_RUNS);
    const payload = JSON.stringify(list, null, 2);
    const tmpPath = `${runsFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, payload, "utf8");
    // Windows refuses the atomic replace while a reader has the file open, and
    // the poller reads it constantly. Retrying the rename keeps the swap atomic;
    // the old in-place fallback is what let readers see a half-written file.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rename(tmpPath, runsFile);
        return;
      } catch {
        await delay(25 * (attempt + 1));
      }
    }
    await writeFile(runsFile, payload, "utf8");
    await unlink(tmpPath).catch(() => undefined);
  };
  persistQueue = persistQueue.then(write, write);
  await persistQueue;
}

async function update(run: PipelineRun, patch: Partial<PipelineRun>) {
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  await persistRuns();
}

export async function listRuns(): Promise<PipelineRun[]> {
  await loadRuns();
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRun(id: string): Promise<PipelineRun | undefined> {
  await loadRuns();
  return runs.get(id);
}

/** Removes the run record only — the long-form project, clip job, and other outputs stay in their own tools. */
export async function deleteRun(id: string) {
  await loadRuns();
  runs.delete(id);
  await persistRuns();
}

function newRunRecord(fields: Partial<PipelineRun> & Pick<PipelineRun, "name" | "status">): PipelineRun {
  const now = new Date().toISOString();
  const run: PipelineRun = {
    id: crypto.randomUUID().slice(0, 8),
    notices: [],
    createdAt: now,
    updatedAt: now,
    ...fields
  };
  runs.set(run.id, run);
  return run;
}

/**
 * Starts a run from a VOD link: the full video downloads to a shared source
 * in the background, then the fan-out begins. Returns immediately with the
 * run in the `ingesting` state so the client can poll.
 */
export async function createRunFromUrl(url: string, name?: string): Promise<PipelineRun> {
  await loadRuns();
  const run = newRunRecord({
    name: (name ?? "").trim() || "Stream",
    status: "ingesting",
    progress: 2,
    sourceUrl: url
  });
  await persistRuns();
  void ingestFromUrl(run, url, name).catch(async (error) => {
    await update(run, { status: "error", error: error instanceof Error ? error.message : String(error) });
  });
  return run;
}

/** Starts a run from an already-uploaded source (`POST /api/clips/sources`). */
export async function createRunFromSource(sourceId: string, name?: string): Promise<PipelineRun> {
  await loadRuns();
  const meta = await readSourceMeta(sourceId);
  if (!meta) throw new Error("That uploaded video could not be found. Upload it again.");
  const run = newRunRecord({
    name: (name ?? "").trim() || meta.fileName.replace(/\.[a-z0-9]+$/i, "") || meta.fileName,
    status: "running",
    sourceId,
    fileName: meta.fileName,
    durationSec: meta.durationSec
  });
  await persistRuns();
  await advanceRun(run);
  return run;
}

async function ingestFromUrl(run: PipelineRun, url: string, name?: string) {
  const meta = await saveSourceFromUrl(url, (pct) => {
    const next = Math.max(2, Math.min(99, Math.round(pct)));
    if (next !== run.progress) void update(run, { progress: next });
  });
  await update(run, {
    status: "running",
    progress: undefined,
    sourceId: meta.id,
    fileName: meta.fileName,
    durationSec: meta.durationSec,
    name: (name ?? "").trim() || meta.fileName.replace(/\.[a-z0-9]+$/i, "") || run.name
  });
  await advanceRun(run);
}

const MAX_NOTICES = 20;

/**
 * Condenses a failure into one storable line. Tool output (ffmpeg, yt-dlp)
 * arrives as a multi-KB dump with a fresh heap pointer embedded in every run —
 * so the plain dedupe below never matched and a retrying step grew `runs.json`
 * without bound. Scrubbing the addresses is what makes the dedupe work.
 */
function noticeText(message: string): string {
  const line = message
    .replace(/0x[0-9a-f]{4,}/gi, "0x…")
    .replace(/\b[0-9a-f]{12,}\b/gi, "…")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

/** Runs one advance step at most once at a time, tolerating failures. */
async function step(
  run: PipelineRun,
  key: string,
  work: () => Promise<void>,
  onError?: (message: string) => Promise<void>
) {
  const guard = `${run.id}:${key}`;
  if (inflight.has(guard)) return;
  inflight.add(guard);
  try {
    await work();
  } catch (error) {
    const message = noticeText(error instanceof Error ? error.message : String(error));
    if (!run.notices.includes(message)) {
      run.notices.push(message);
      if (run.notices.length > MAX_NOTICES) run.notices.splice(0, run.notices.length - MAX_NOTICES);
    }
    if (onError) await onError(message);
    await persistRuns();
  } finally {
    inflight.delete(guard);
  }
}

/**
 * Looks at where the run stands and kicks whatever can start next. Called on
 * every poll (and after ingest), so the pipeline advances no matter which
 * request observes a finished stage — and a restarted server just picks up
 * where the records left off. Every step is idempotent behind an id check.
 */
export async function advanceRun(run: PipelineRun): Promise<void> {
  if (run.status !== "running" || !run.sourceId) return;
  const sourceId = run.sourceId;

  // Fan out both editors from the shared source. Cheap (they background their
  // own work), so these are awaited to get ids into the run record early.
  if (!run.longformProjectId) {
    await step(run, "longform", async () => {
      const project = await createProject(sourceId, run.name);
      await update(run, { longformProjectId: project.id });
    });
  }
  if (!run.clipJobId) {
    await step(run, "clips", async () => {
      const job = await createJobFromUpload(sourceId, undefined);
      await update(run, { clipJobId: job.id });
    });
  }

  const project = run.longformProjectId ? await getProject(run.longformProjectId) : undefined;
  const job = run.clipJobId ? await getJob(run.clipJobId) : undefined;

  // Long-form analysis done → start the export render (or adopt one the user
  // already started from the Long-Form Editor).
  if (project && project.status === "ready" && !run.longformExportId) {
    // Only a whole-edit export can stand in for the run's long-form output; a
    // topic-segment render is one of several videos, not the video.
    const existing = project.exports.find(
      (record) => !record.topicId && (record.status === "done" || record.status === "processing")
    );
    if (existing) {
      await update(run, { longformExportId: existing.id });
    } else {
      void step(run, "export", async () => {
        const record = await startLongformExport(project);
        await update(run, { longformExportId: record.id });
      });
    }
  }

  // Export rendered → extract the podcast MP3 from the finished file, so the
  // audio carries the exact same cuts and mix. Idempotent: skips if present.
  const exportRecord = project?.exports.find((record) => record.id === run.longformExportId);
  if (project && exportRecord?.status === "done" && exportRecord.file && !exportRecord.audioFile && !run.audioNote) {
    // A source with no audio track has nothing to extract. Without this the
    // step re-ran `ffmpeg -vn` on every poll forever, the stage never left
    // "Extracting the MP3…", and the run never settled.
    if (project.hasAudio === false) {
      await update(run, { audioNote: "This recording has no audio track, so there is no podcast MP3 to cut." });
    } else {
    void step(run, "audio", async () => {
      const outputDir = projectOutputDir(project.id);
      const videoPath = path.join(outputDir, exportRecord.file!);
      const audioName = exportRecord.file!.replace(/\.[a-z0-9]+$/i, "") + ".mp3";
      const audioPath = path.join(outputDir, audioName);
      const exists = await stat(audioPath).then(
        () => true,
        () => false
      );
      if (!exists) {
        await runFfmpeg(["-y", "-i", videoPath, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", audioPath]);
      }
      exportRecord.audioFile = audioName;
      await updateProject(project.id, { exports: project.exports });
      await persistRuns();
    }, async () => {
      // One shot. ffmpeg failing here means the edit has no usable audio, and
      // retrying it every 2.5s is what spammed the notices.
      await update(run, { audioNote: "The podcast MP3 could not be cut from the edited video." });
    });
    }
  }

  // The long-form analysis only transcribes the opening of a long stream (the
  // hook is all it needs), while the clip job transcribes the whole thing.
  // Once that full transcript exists, plan the stream's topic segments from
  // it — the long-form project picks it up automatically because both sides
  // work from the same source id. One attempt is enough: the clip job writes
  // its transcript once.
  if (project && project.status === "ready" && !project.topics && !run.segmentsPlanned && job?.sourceCaptions?.length) {
    void step(run, "segments", async () => {
      await planProjectTopics(project.id);
      await update(run, { segmentsPlanned: true });
    });
  }

  // Transcript ready → write the carousel images copy from it. `carouselNote`
  // doubles as the "already tried and failed" marker: without it this step
  // would re-run on every poll, and each attempt now costs three model calls.
  if (project && project.status === "ready" && !run.carouselId && !run.carouselNote) {
    const transcriptText = project.transcript.map((segment) => segment.text).join(" ");
    if (speechWordCount(transcriptText) < MIN_SPEECH_WORDS) {
      if (project.transcript.length > 0) {
        await update(run, { carouselNote: "No speech was transcribed from this stream to write slides from." });
      }
    } else {
    void step(run, "carousel", async () => {
      // The slides are illustrated with stills from the stream itself, one per
      // slide and in order, so the deck reads as the video it was written from
      // rather than eight gradients. Failing to take them is not a reason to
      // skip the carousel — the copy still stands on its own.
      const frames = project.sourceId
        ? await framesForSource(project.sourceId, DEFAULT_SLIDE_COUNT).catch(() => ({ images: [], note: null }))
        : { images: [], note: null };
      const { carousel, reason } = await generateCarousel({
        title: run.name,
        sourceText: transcriptText,
        slideCount: DEFAULT_SLIDE_COUNT,
        sourceType: "longform",
        sourceId: project.id,
        images: frames.images,
        imageMode: "backdrop",
        // Nobody is watching this one. Transcript-sliced slides would be
        // counted as "ready to schedule" and could reach a queue unread.
        requireModel: true
      });
      if (!carousel) {
        await update(run, { carouselNote: reason ?? "No carousel slides were written." });
        return;
      }
      const data = await readAppData();
      const studio = data.videoStudio ?? defaultVideoStudio;
      await writeAppData({ ...data, videoStudio: { ...studio, carousels: [carousel, ...studio.carousels] } });
      await update(run, {
        carouselId: carousel.id,
        carouselNote: [reason, frames.note].filter(Boolean).join(" ") || undefined
      });
    });
    }
  }

  // Text posts want the richest material: the transcript plus the clip job's
  // finished titles. Fire once both sides have settled (either can fail —
  // whatever material exists is used).
  const longformSettled = !project || project.status !== "processing";
  const clipsSettled = !job || job.status === "done" || job.status === "error";
  // Real speech, not just Whisper's non-speech tags: a music-only or silent
  // recording used to reach this point with a transcript full of "(bells
  // ringing)" and have a whole content pack invented from it.
  const transcriptText = project?.transcript.map((segment) => segment.text).join(" ") ?? "";
  const captionText = (job?.sourceCaptions ?? []).map((segment) => segment.text).join(" ");
  const hasMaterial =
    speechWordCount(transcriptText) >= MIN_SPEECH_WORDS || speechWordCount(captionText) >= MIN_SPEECH_WORDS;
  if (!run.posts && longformSettled && clipsSettled && (project || job) && !hasMaterial) {
    // Both sides settled with nothing to write from — record the skip so the
    // stage (and the run) can finish instead of waiting forever.
    await update(run, { posts: [], postsNote: "No speech was transcribed from this stream to write posts from." });
  }
  if (!run.posts && longformSettled && clipsSettled && hasMaterial && (project || job)) {
    void step(run, "posts", async () => {
      const { posts, reason } = await generatePipelinePosts({
        streamTitle: run.name,
        transcriptText,
        clipHighlights: (job?.clips ?? [])
          .filter((clip) => clip.title)
          .map((clip) => ({ title: clip.title!, quote: clip.hookQuote }))
      });
      await update(run, { posts, postsNote: reason ?? undefined });
    });
  }
}

// ----- Overview: the joined, per-stage view the pipeline page renders -----

function stage(status: PipelineStageStatus, detail: string, progress?: number): PipelineStage {
  return { status, detail, progress };
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sourceStage(run: PipelineRun): PipelineStage {
  if (run.status === "error") return stage("error", run.error ?? "Ingest failed.");
  if (run.status === "ingesting") return stage("running", "Downloading the stream…", run.progress);
  const length = run.durationSec ? ` · ${formatDuration(run.durationSec)}` : "";
  return stage("ready", `${run.fileName ?? "Source"}${length}`);
}

function longformStage(run: PipelineRun, project: LongformProject | undefined): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (!project) return stage(run.longformProjectId ? "error" : "running", run.longformProjectId ? "The long-form project is gone — it may have been deleted." : "Creating the long-form project…");
  if (project.status === "error") return stage("error", project.error ?? "Analysis failed.");
  if (project.status === "processing") {
    const labels: Record<string, string> = {
      downloading: "Fetching the source…",
      probing: "Reading the video…",
      transcribing: "Transcribing…",
      analyzing: "Finding dead space…",
      planning: "Planning the edit…"
    };
    return stage("running", labels[project.stage] ?? "Analyzing…", project.progress);
  }
  const record = project.exports.find((item) => item.id === run.longformExportId);
  if (!record) return stage("running", "Edit planned — starting the export…");
  if (record.status === "processing") return stage("running", "Rendering the edited video…", record.progress);
  if (record.status === "done" && record.file) {
    const length = record.durationSec ? ` · ${formatDuration(record.durationSec)}` : "";
    return stage("ready", `Edited video rendered${length}`);
  }
  return stage("error", record.error ?? "The export failed. Open the Long-Form Editor to retry.");
}

/**
 * Topic segments: the stream split into the separate subjects it covered, each
 * one publishable as its own long-form video. They are planned automatically
 * but rendered on demand — five ten-minute renders per stream is hours of
 * encoding nobody asked for, so the Long-Form Editor's Segments tab starts them.
 */
function segmentsStage(
  run: PipelineRun,
  project: LongformProject | undefined,
  rendered: number,
  job: ClipJob | undefined
): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (project?.status === "error") return stage("skipped", "Needs the transcript, and analysis failed.");
  if (!project || project.status === "processing") return stage("waiting", "Split from the transcript once analysis finishes.");
  const topics = project.topics;
  if (!topics) {
    // The whole-recording transcript comes from the clip job. Once that has
    // settled and any pending plan attempt has run, no transcript is ever
    // coming — reporting `running` forever is what left a run from five days
    // ago still claiming to be reading its transcript.
    const clipsSettled = !job || job.status === "done" || job.status === "error";
    const attemptPending = Boolean(job?.sourceCaptions?.length) && !run.segmentsPlanned;
    if (clipsSettled && !attemptPending) {
      return stage(
        "skipped",
        project.topicsNote ?? "No whole-recording transcript came out of this stream to split into subjects."
      );
    }
    return stage("running", project.topicsNote ? "Waiting on the full transcript…" : "Reading the transcript for subjects…");
  }
  if (topics.length === 0) {
    return stage("skipped", project.topicsNote ?? "This recording reads as one continuous topic.");
  }
  const renderedNote = rendered > 0 ? ` · ${rendered} rendered` : "";
  return stage("ready", `${topics.length} topic segment${topics.length === 1 ? "" : "s"} ready to render${renderedNote}`);
}

/** Below this a clip is padding rather than a moment anyone chose. */
const WEAK_CLIP_SCORE = 25;

function clipsStage(run: PipelineRun, job: ClipJob | undefined): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (!job) return stage(run.clipJobId ? "error" : "running", run.clipJobId ? "The clip job is gone — it may have been deleted." : "Creating the clip job…");
  const ready = job.clips.filter((clip) => clip.editedFile || clip.downloadFile || clip.file).length;
  if (job.status === "error") return stage("error", job.error ?? "Clipping failed.");
  if (job.status === "done") {
    if (ready === 0) return stage("error", "The job finished but no clips rendered.");
    // A job that could not find enough strong moments pads the list with
    // evenly-spaced filler. Those rendered identically to a 79-scoring clip and
    // were counted the same in "ready to schedule" — worth saying out loud
    // before anyone queues them.
    const weak = job.clips.filter(
      (clip) => (clip.editedFile || clip.downloadFile || clip.file) && clip.score < WEAK_CLIP_SCORE
    ).length;
    const weakNote = weak > 0 ? ` · ${weak} scored low, worth a look before queueing` : "";
    return stage("ready", `${ready} short${ready === 1 ? "" : "s"} rendered, ready to schedule${weakNote}`);
  }
  const labels: Record<string, string> = {
    downloading: "Reading the source…",
    analyzing: "Transcribing…",
    selecting: "Picking the best moments…",
    rendering: ready > 0 ? `Rendering clips — ${ready} ready so far…` : "Rendering clips…"
  };
  return stage("running", labels[job.stage] ?? "Working…", job.progress);
}

function audioStage(run: PipelineRun, project: LongformProject | undefined): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  const record = project?.exports.find((item) => item.id === run.longformExportId);
  if (project?.status === "error") return stage("skipped", "Needs the long-form edit, which failed.");
  if (!record || record.status === "processing") return stage("waiting", "Cut from the edited video once it renders.");
  if (record.status === "done" && record.audioFile) return stage("ready", "Podcast MP3 extracted from the edit");
  if (run.audioNote) return stage("skipped", run.audioNote);
  if (record.status === "done") return stage("running", "Extracting the MP3…");
  return stage("skipped", "Needs the long-form edit, which failed.");
}

function imagesStage(run: PipelineRun, project: LongformProject | undefined, slideCount: number): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (run.carouselId) {
    // No slides behind the id means the carousel was deleted from the Studio.
    // Reporting DEFAULT_SLIDE_COUNT here claimed "8 carousel slides written"
    // for a carousel that no longer exists — the same phrasing the clips stage
    // uses for a missing job, since the count is best-effort and a failed read
    // looks identical to a deletion.
    if (slideCount === 0) return stage("error", "The carousel is gone — it may have been deleted.");
    const note = run.carouselNote ? ` (${run.carouselNote})` : "";
    return stage("ready", `${slideCount} carousel slides written${note}`);
  }
  // Attempted and gave up: a note with no carousel. Reported as skipped, never
  // as ready — there is nothing here anyone should schedule.
  if (run.carouselNote) return stage("skipped", run.carouselNote);
  if (project?.status === "error") return stage("skipped", "Needs the transcript, and analysis failed.");
  if (project?.status === "ready" && project.transcript.length === 0) {
    return stage("skipped", "No transcript came out of this stream to write slides from.");
  }
  if (project?.status === "ready") return stage("running", "Writing carousel slides from the transcript…");
  return stage("waiting", "Written from the transcript once analysis finishes.");
}

function visualsStage(run: PipelineRun, job: ClipJob | undefined, ready: boolean): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (!job) return stage("waiting", "Waiting for the clip analysis.");
  if (ready) return stage("ready", "Best transcript moment ready for a realistic screenshot ad");
  // A settled job with no moment has none coming — the old `waiting` here left
  // the run unsettled for good on any stream without usable speech.
  if (job.status === "error" || job.status === "done") {
    return stage("skipped", "No strong transcript moment was available.");
  }
  return stage("waiting", "Choosing the strongest transcript moment and frame.");
}

function postsStage(run: PipelineRun): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (run.posts && run.posts.length > 0) {
    const note = run.postsNote ? ` (${run.postsNote})` : "";
    return stage("ready", `${run.posts.length} text posts written${note}`);
  }
  if (run.posts) return stage("skipped", run.postsNote ?? "Nothing to write from.");
  return stage("waiting", "Written from the transcript and clip titles once they exist.");
}

/**
 * The reads every run's overview wants but none of them owns: the carousel
 * list out of a 10 MB app-data file, and the publish queue. `GET /api/pipeline`
 * builds one of these for the whole request — re-reading both per run made a
 * poll of nine runs take seconds, on a 2.5s poll interval.
 */
export type OverviewContext = {
  carousels: () => Promise<{ id: string; slides: unknown[] }[]>;
  queuedByJob: () => Promise<Map<string, number>>;
};

export function overviewContext(): OverviewContext {
  let carousels: Promise<{ id: string; slides: unknown[] }[]> | undefined;
  let queued: Promise<Map<string, number>> | undefined;
  return {
    carousels: () =>
      (carousels ??= readAppData()
        .then((data) => (data.videoStudio ?? defaultVideoStudio).carousels)
        .catch(() => [])),
    queuedByJob: () =>
      (queued ??= (async () => {
        const counts = new Map<string, number>();
        const config = publisherConfig();
        if (!config.enabled) return counts;
        try {
          for (const item of await publishQueue(config).list()) {
            if (item.jobId) counts.set(item.jobId, (counts.get(item.jobId) ?? 0) + 1);
          }
        } catch {
          // Best-effort count.
        }
        return counts;
      })())
  };
}

/**
 * Joins the run with the live state of everything it references. Also
 * advances the run first, so polling the overview IS what drives the
 * pipeline forward.
 */
export async function runOverview(run: PipelineRun, context?: OverviewContext): Promise<PipelineRunOverview> {
  await advanceRun(run);

  const ctx = context ?? overviewContext();
  const project = run.longformProjectId ? await getProject(run.longformProjectId) : undefined;
  const job = run.clipJobId ? await getJob(run.clipJobId) : undefined;
  const exportRecord = project?.exports.find((item) => item.id === run.longformExportId);

  let slideCount = 0;
  if (run.carouselId) {
    const carousels = await ctx.carousels();
    slideCount = carousels.find((c) => c.id === run.carouselId)?.slides.length ?? 0;
  }

  // Best-effort: how many publish-queue items already came from this clip job.
  let queued = 0;
  if (run.clipJobId) {
    queued = (await ctx.queuedByJob()).get(run.clipJobId) ?? 0;
  }

  const clipsReady = (job?.clips ?? []).filter((clip) => clip.editedFile || clip.downloadFile || clip.file).length;
  const longformReady = Boolean(exportRecord?.status === "done" && exportRecord.file);
  const audioReady = Boolean(exportRecord?.audioFile);
  const posts = run.posts?.length ?? 0;
  const moment = visualMomentFromClips(job?.clips ?? [], job?.sourceCaptions ?? [], run.durationSec);
  const visualMoment = moment
    ? { ...moment, prompt: realisticImagePrompt(moment, run.name) }
    : undefined;

  const topics = project?.topics ?? [];
  const segmentsRendered = topics.filter((topic) =>
    project?.exports.some((item) => item.topicId === topic.id && item.status === "done" && item.file)
  ).length;

  const stages = {
    source: sourceStage(run),
    longform: longformStage(run, project),
    segments: segmentsStage(run, project, segmentsRendered, job),
    clips: clipsStage(run, job),
    audio: audioStage(run, project),
    images: imagesStage(run, project, slideCount),
    visuals: visualsStage(run, job, Boolean(visualMoment)),
    posts: postsStage(run),
    schedule: stage("waiting", "")
  };

  const readyItems =
    clipsReady +
    (longformReady ? 1 : 0) +
    (audioReady ? 1 : 0) +
    (slideCount > 0 ? 1 : 0) +
    (visualMoment ? 1 : 0) +
    posts +
    segmentsRendered;
  const upstreamSettled = (["longform", "segments", "clips", "audio", "images", "visuals", "posts"] as const).every(
    (key) => stages[key].status !== "running" && stages[key].status !== "waiting"
  );
  if (run.status === "error") {
    stages.schedule = stage("error", "Nothing reached the scheduler — the source never ingested.");
  } else if (readyItems === 0) {
    stages.schedule = stage("waiting", "Outputs land here as each one finishes.");
  } else {
    stages.schedule = stage(
      upstreamSettled ? "ready" : "running",
      `${readyItems} output${readyItems === 1 ? "" : "s"} ready to schedule${queued > 0 ? ` · ${queued} already queued` : ""}`
    );
  }

  return {
    run,
    stages,
    visualMoment,
    schedulable: {
      clipsReady,
      longformReady,
      segments: topics.length,
      audioReady,
      carouselSlides: slideCount,
      visualAdReady: Boolean(visualMoment),
      posts,
      queued
    },
    settled:
      run.status === "error" ||
      (upstreamSettled && stages.source.status !== "running" && stages.schedule.status !== "running")
  };
}
