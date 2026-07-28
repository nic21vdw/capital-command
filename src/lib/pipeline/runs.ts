import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createJobFromUpload, getJob } from "@/lib/clipping/jobs";
import { readSourceMeta, saveSourceFromUrl } from "@/lib/clipping/sources";
import type { ClipJob } from "@/lib/clipping/types";
import { startLongformExport } from "@/lib/longform/render";
import { createProject, getProject, projectOutputDir, updateProject } from "@/lib/longform/store";
import type { LongformProject } from "@/lib/longform/types";
import { generatePipelinePosts } from "@/lib/pipeline/posts";
import { realisticImagePrompt, visualMomentFromClips } from "@/lib/pipeline/visual-brief";
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
import { DEFAULT_SLIDE_COUNT, generateCarousel } from "@/lib/studio/carousel";

// A run is a thin coordination record over the existing subsystems — the
// media itself lives with the long-form project, the clip job, and the shared
// source. Same persistence pattern as those stores: a globalThis map (Next
// dev gives each route its own module graph) flushed to one JSON file.

const pipelineRoot = path.join(process.cwd(), "data", "pipeline");
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

async function loadRuns() {
  if (g.__pipelineRunsLoaded) return;
  g.__pipelineRunsLoaded = true;
  try {
    const raw = await readFile(runsFile, "utf8");
    for (const run of JSON.parse(raw) as PipelineRun[]) {
      // A download that was mid-flight when the server stopped can't resume.
      // Everything after ingest is re-driven by advanceRun, so `running`
      // survives a restart (the underlying stores mark their own casualties).
      if (run.status === "ingesting") {
        run.status = "error";
        run.error = "The server restarted while the stream was downloading. Start the run again.";
      }
      runs.set(run.id, run);
    }
  } catch {
    // First run — no file yet.
  }
}

async function persistRuns() {
  const write = async () => {
    await mkdir(pipelineRoot, { recursive: true });
    const list = [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_RUNS);
    const payload = JSON.stringify(list, null, 2);
    const tmpPath = `${runsFile}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, payload, "utf8");
    try {
      await rename(tmpPath, runsFile);
    } catch {
      // Windows can refuse the atomic replace while the file is read; fall
      // back to an in-place write like the other stores do.
      await writeFile(runsFile, payload, "utf8");
      await unlink(tmpPath).catch(() => undefined);
    }
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

/** Runs one advance step at most once at a time, tolerating failures. */
async function step(run: PipelineRun, key: string, work: () => Promise<void>) {
  const guard = `${run.id}:${key}`;
  if (inflight.has(guard)) return;
  inflight.add(guard);
  try {
    await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!run.notices.includes(message)) run.notices.push(message);
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
    const existing = project.exports.find((record) => record.status === "done" || record.status === "processing");
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
  if (project && exportRecord?.status === "done" && exportRecord.file && !exportRecord.audioFile) {
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
    });
  }

  // Transcript ready → write the carousel images copy from it. `carouselNote`
  // doubles as the "already tried and failed" marker: without it this step
  // would re-run on every poll, and each attempt now costs three model calls.
  if (
    project &&
    project.status === "ready" &&
    project.transcript.length > 0 &&
    !run.carouselId &&
    !run.carouselNote
  ) {
    void step(run, "carousel", async () => {
      const { carousel, reason } = await generateCarousel({
        title: run.name,
        sourceText: project.transcript.map((segment) => segment.text).join(" "),
        slideCount: DEFAULT_SLIDE_COUNT,
        sourceType: "longform",
        sourceId: project.id,
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
      await update(run, { carouselId: carousel.id, carouselNote: reason ?? undefined });
    });
  }

  // Text posts want the richest material: the transcript plus the clip job's
  // finished titles. Fire once both sides have settled (either can fail —
  // whatever material exists is used).
  const longformSettled = !project || project.status !== "processing";
  const clipsSettled = !job || job.status === "done" || job.status === "error";
  const hasMaterial = Boolean(project?.transcript.length) || Boolean(job?.clips.some((clip) => clip.title));
  if (!run.posts && longformSettled && clipsSettled && (project || job) && !hasMaterial) {
    // Both sides settled with nothing to write from — record the skip so the
    // stage (and the run) can finish instead of waiting forever.
    await update(run, { posts: [], postsNote: "No transcript or clip titles came out of this stream to write from." });
  }
  if (!run.posts && longformSettled && clipsSettled && hasMaterial && (project || job)) {
    void step(run, "posts", async () => {
      const { posts, reason } = await generatePipelinePosts({
        streamTitle: run.name,
        transcriptText: project?.transcript.map((segment) => segment.text).join(" ") ?? "",
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

function clipsStage(run: PipelineRun, job: ClipJob | undefined): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (!job) return stage(run.clipJobId ? "error" : "running", run.clipJobId ? "The clip job is gone — it may have been deleted." : "Creating the clip job…");
  const ready = job.clips.filter((clip) => clip.editedFile || clip.downloadFile || clip.file).length;
  if (job.status === "error") return stage("error", job.error ?? "Clipping failed.");
  if (job.status === "done") {
    if (ready === 0) return stage("error", "The job finished but no clips rendered.");
    return stage("ready", `${ready} short${ready === 1 ? "" : "s"} rendered, ready to schedule`);
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
  if (job.status === "error") return stage("skipped", "No strong transcript moment was available.");
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
 * Joins the run with the live state of everything it references. Also
 * advances the run first, so polling the overview IS what drives the
 * pipeline forward.
 */
export async function runOverview(run: PipelineRun): Promise<PipelineRunOverview> {
  await advanceRun(run);

  const project = run.longformProjectId ? await getProject(run.longformProjectId) : undefined;
  const job = run.clipJobId ? await getJob(run.clipJobId) : undefined;
  const exportRecord = project?.exports.find((item) => item.id === run.longformExportId);

  let slideCount = 0;
  if (run.carouselId) {
    try {
      const data = await readAppData();
      slideCount = (data.videoStudio ?? defaultVideoStudio).carousels.find((c) => c.id === run.carouselId)?.slides.length ?? 0;
    } catch {
      // Non-critical count.
    }
  }

  // Best-effort: how many publish-queue items already came from this clip job.
  let queued = 0;
  const config = publisherConfig();
  if (config.enabled && run.clipJobId) {
    try {
      const items = await publishQueue(config).list();
      queued = items.filter((item) => item.jobId === run.clipJobId).length;
    } catch {
      queued = 0;
    }
  }

  const clipsReady = (job?.clips ?? []).filter((clip) => clip.editedFile || clip.downloadFile || clip.file).length;
  const longformReady = Boolean(exportRecord?.status === "done" && exportRecord.file);
  const audioReady = Boolean(exportRecord?.audioFile);
  const posts = run.posts?.length ?? 0;
  const moment = visualMomentFromClips(job?.clips ?? [], job?.sourceCaptions ?? []);
  const visualMoment = moment
    ? { ...moment, prompt: realisticImagePrompt(moment, run.name) }
    : undefined;

  const stages = {
    source: sourceStage(run),
    longform: longformStage(run, project),
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
    posts;
  const upstreamSettled = (["longform", "clips", "audio", "images", "visuals", "posts"] as const).every(
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
