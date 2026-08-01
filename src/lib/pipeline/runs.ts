import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import {
  approveClipRenders,
  createJobFromUpload,
  dropClipCandidates,
  getJob,
  renameJob
} from "@/lib/clipping/jobs";
import { readSourceMeta, saveSourceFromUrl } from "@/lib/clipping/sources";
import type { ClipJob } from "@/lib/clipping/types";
import { startLongformExport } from "@/lib/longform/render";
import { createProject, getProject, planProjectTopics, projectOutputDir, updateProject } from "@/lib/longform/store";
import type { LongformProject } from "@/lib/longform/types";
import { defaultPipelinePlan, describePlan, normalizePipelinePlan, plannedOutputs } from "@/lib/pipeline/plan";
import { generatePipelinePosts } from "@/lib/pipeline/posts";
import { realisticImagePrompt, visualMomentFromClips } from "@/lib/pipeline/visual-brief";
import type {
  PipelinePlan,
  PipelineReview,
  PipelineRun,
  PipelineRunOverview,
  PipelineStage,
  PipelineStageStatus
} from "@/lib/pipeline/types";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { generateCarousel } from "@/lib/studio/carousel";

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

/** The plan a run is working to; older records predate plans and get the defaults. */
function runPlan(run: PipelineRun): PipelinePlan {
  return run.plan ?? defaultPipelinePlan();
}

/** True when the expensive half — the long-form export and the clip renders — may start. */
function rendersApproved(run: PipelineRun): boolean {
  return Boolean(run.autoApprove || run.outputsApprovedAt);
}

export type CreateRunOptions = {
  /** Partial plan from the request; anything missing takes the default. */
  plan?: unknown;
  /**
   * Skip both gates. Only for runs nobody is watching (the channel scan), which
   * would otherwise sit at "waiting for approval" forever.
   */
  autoApprove?: boolean;
};

/**
 * Starts a run from a VOD link. By default it stops at the plan: NOTHING is
 * downloaded until `approvePlan` — the point of the gate is that a stream is
 * only worth fetching once the run's shape has been agreed. An `autoApprove`
 * run begins ingesting immediately, exactly as it used to.
 */
export async function createRunFromUrl(
  url: string,
  name?: string,
  options?: CreateRunOptions
): Promise<PipelineRun> {
  await loadRuns();
  const autoApprove = options?.autoApprove === true;
  const requested = (name ?? "").trim();
  const run = newRunRecord({
    name: requested || "Stream",
    status: autoApprove ? "ingesting" : "planning",
    progress: autoApprove ? 2 : undefined,
    sourceUrl: url,
    plan: normalizePipelinePlan(options?.plan),
    requestedName: requested || undefined,
    autoApprove: autoApprove || undefined,
    planApprovedAt: autoApprove ? new Date().toISOString() : undefined
  });
  await persistRuns();
  if (autoApprove) void ingestFromUrl(run, url).catch((error) => failRun(run, error));
  return run;
}

/**
 * Starts a run from an already-uploaded source (`POST /api/clips/sources`). The
 * file is on disk by the time this is called, so the plan gate here buys the
 * analysis and render time rather than the download.
 */
export async function createRunFromSource(
  sourceId: string,
  name?: string,
  options?: CreateRunOptions
): Promise<PipelineRun> {
  await loadRuns();
  const meta = await readSourceMeta(sourceId);
  if (!meta) throw new Error("That uploaded video could not be found. Upload it again.");
  const autoApprove = options?.autoApprove === true;
  const run = newRunRecord({
    name: (name ?? "").trim() || meta.fileName.replace(/\.[a-z0-9]+$/i, "") || meta.fileName,
    status: autoApprove ? "running" : "planning",
    sourceId,
    fileName: meta.fileName,
    durationSec: meta.durationSec,
    plan: normalizePipelinePlan(options?.plan),
    autoApprove: autoApprove || undefined,
    planApprovedAt: autoApprove ? new Date().toISOString() : undefined
  });
  await persistRuns();
  if (autoApprove) await advanceRun(run);
  return run;
}

async function failRun(run: PipelineRun, error: unknown) {
  await update(run, { status: "error", error: error instanceof Error ? error.message : String(error) });
}

/**
 * Gate one. Accepts the plan (with any edits made while it was on screen) and
 * lets the run start: the download for a link, the fan-out for an upload.
 * Idempotent — a run that already started is returned untouched, so a
 * double-click cannot download the same stream twice.
 */
export async function approvePlan(runId: string, plan?: unknown): Promise<PipelineRun | undefined> {
  await loadRuns();
  const run = runs.get(runId);
  if (!run) return undefined;
  if (run.status !== "planning") return run;
  const approved = normalizePipelinePlan(plan, runPlan(run));
  const now = new Date().toISOString();
  if (run.sourceUrl) {
    await update(run, { plan: approved, planApprovedAt: now, status: "ingesting", progress: 2 });
    void ingestFromUrl(run, run.sourceUrl).catch((error) => failRun(run, error));
  } else {
    await update(run, { plan: approved, planApprovedAt: now, status: "running" });
    await advanceRun(run);
  }
  return run;
}

/**
 * Gate two. Releases the renders: the long-form export and the clip encodes
 * start on this call (and on the poll that follows), using whatever survived
 * the review.
 */
export async function approveOutputs(runId: string): Promise<PipelineRun | undefined> {
  await loadRuns();
  const run = runs.get(runId);
  if (!run) return undefined;
  if (!run.outputsApprovedAt) await update(run, { outputsApprovedAt: new Date().toISOString() });
  await advanceRun(run);
  return run;
}

/** An edit made at one of the gates, before the run has been approved. */
export type PipelineRevision = {
  /** Plan edits, while the run is still `planning`. */
  plan?: unknown;
  approve?: "plan" | "outputs";
  clipTitles?: Array<{ id: string; title: string }>;
  dropClips?: string[];
  segmentTitles?: Array<{ id: string; title: string }>;
  dropSegments?: string[];
  postTexts?: Array<{ id: string; text: string }>;
  dropPosts?: string[];
};

/**
 * Applies a review edit and, when asked, approves the gate in the same call —
 * so the button that says "Approve" always acts on exactly what is on screen.
 * Edits are refused once the renders are away: at that point the outputs belong
 * to their own tools, which is where they can still be changed.
 */
export async function reviseRun(runId: string, revision: PipelineRevision): Promise<PipelineRun | undefined> {
  await loadRuns();
  const run = runs.get(runId);
  if (!run) return undefined;

  if (revision.approve === "plan") return approvePlan(runId, revision.plan);
  if (revision.plan) {
    if (run.status !== "planning") throw new Error("This run has already started — the plan can no longer be changed.");
    await update(run, { plan: normalizePipelinePlan(revision.plan, runPlan(run)) });
    return run;
  }
  if (run.outputsApprovedAt) {
    throw new Error("This run is already rendering — edit these outputs in their own tools.");
  }

  if (run.clipJobId) {
    for (const edit of revision.clipTitles ?? []) {
      await renameJob(run.clipJobId, { clipId: edit.id, clipTitle: edit.title });
    }
    if (revision.dropClips?.length) await dropClipCandidates(run.clipJobId, revision.dropClips);
  }

  if (run.longformProjectId && (revision.segmentTitles?.length || revision.dropSegments?.length)) {
    const project = await getProject(run.longformProjectId);
    if (project?.topics) {
      const dropped = new Set(revision.dropSegments ?? []);
      const titles = new Map((revision.segmentTitles ?? []).map((edit) => [edit.id, edit.title.trim()]));
      const topics = project.topics
        .filter((topic) => !dropped.has(topic.id))
        .map((topic) => (titles.get(topic.id) ? { ...topic, title: titles.get(topic.id)! } : topic));
      await updateProject(project.id, { topics });
    }
  }

  if (run.posts && (revision.postTexts?.length || revision.dropPosts?.length)) {
    const dropped = new Set(revision.dropPosts ?? []);
    const texts = new Map((revision.postTexts ?? []).map((edit) => [edit.id, edit.text.trim()]));
    const posts = run.posts
      .filter((post) => !dropped.has(post.id))
      .map((post) => (texts.get(post.id) ? { ...post, text: texts.get(post.id)! } : post));
    await update(run, { posts });
  }

  if (revision.approve === "outputs") return approveOutputs(runId);
  return run;
}

async function ingestFromUrl(run: PipelineRun, url: string) {
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
    // A name typed with the link wins over the VOD's own title; the download
    // may finish long after the plan was approved, so it is read off the record
    // rather than passed in.
    name: (run.requestedName ?? "").trim() || meta.fileName.replace(/\.[a-z0-9]+$/i, "") || run.name
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
  // `planning` is the first gate: the plan exists, nothing else does, and
  // nothing may start until it is approved.
  if (run.status !== "running" || !run.sourceId) return;
  const sourceId = run.sourceId;
  const plan = runPlan(run);

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
      // The clip job carries the review hold itself: it analyses the stream and
      // stops with its moments picked, so the selection can be edited before a
      // single frame is encoded.
      const job = await createJobFromUpload(sourceId, undefined, plan.clipCount, {
        reviewGate: !run.autoApprove
      });
      await update(run, { clipJobId: job.id });
    });
  }

  const project = run.longformProjectId ? await getProject(run.longformProjectId) : undefined;
  const job = run.clipJobId ? await getJob(run.clipJobId) : undefined;

  // Approved → let the clip job render what survived the review.
  if (job && job.stage === "review" && rendersApproved(run)) {
    await step(run, "clip-renders", async () => {
      await approveClipRenders(job.id);
    });
  }

  // Long-form analysis done → start the export render (or adopt one the user
  // already started from the Long-Form Editor). Held behind the review gate:
  // this is the single most expensive thing the run does.
  if (project && project.status === "ready" && plan.longform && rendersApproved(run) && !run.longformExportId) {
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
  if (project && plan.audio && exportRecord?.status === "done" && exportRecord.file && !exportRecord.audioFile) {
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

  // The long-form analysis only transcribes the opening of a long stream (the
  // hook is all it needs), while the clip job transcribes the whole thing.
  // Once that full transcript exists, plan the stream's topic segments from
  // it — the long-form project picks it up automatically because both sides
  // work from the same source id. One attempt is enough: the clip job writes
  // its transcript once.
  if (
    project &&
    plan.segments &&
    project.status === "ready" &&
    !project.topics &&
    !run.segmentsPlanned &&
    job?.sourceCaptions?.length
  ) {
    void step(run, "segments", async () => {
      await planProjectTopics(project.id);
      await update(run, { segmentsPlanned: true });
    });
  }

  // Transcript ready → write the carousel images copy from it. `carouselNote`
  // doubles as the "already tried and failed" marker: without it this step
  // would re-run on every poll, and each attempt now costs three model calls.
  if (
    project &&
    plan.carouselSlides > 0 &&
    project.status === "ready" &&
    project.transcript.length > 0 &&
    !run.carouselId &&
    !run.carouselNote
  ) {
    void step(run, "carousel", async () => {
      const { carousel, reason } = await generateCarousel({
        title: run.name,
        sourceText: project.transcript.map((segment) => segment.text).join(" "),
        slideCount: plan.carouselSlides,
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
  // whatever material exists is used). A job held for review counts as settled:
  // its titles are written, and the posts are part of what gets reviewed, so
  // waiting for the renders would deadlock the gate against itself.
  const longformSettled = !project || project.status !== "processing";
  const clipsSettled = !job || job.status === "done" || job.status === "error" || job.stage === "review";
  const hasMaterial = Boolean(project?.transcript.length) || Boolean(job?.clips.some((clip) => clip.title));
  const wantsPosts = plan.postPlatforms.length > 0;
  if (wantsPosts && !run.posts && longformSettled && clipsSettled && (project || job) && !hasMaterial) {
    // Both sides settled with nothing to write from — record the skip so the
    // stage (and the run) can finish instead of waiting forever.
    await update(run, { posts: [], postsNote: "No transcript or clip titles came out of this stream to write from." });
  }
  if (wantsPosts && !run.posts && longformSettled && clipsSettled && hasMaterial && (project || job)) {
    void step(run, "posts", async () => {
      const { posts, reason } = await generatePipelinePosts({
        streamTitle: run.name,
        transcriptText: project?.transcript.map((segment) => segment.text).join(" ") ?? "",
        clipHighlights: (job?.clips ?? [])
          .filter((clip) => clip.title)
          .map((clip) => ({ title: clip.title!, quote: clip.hookQuote })),
        platforms: plan.postPlatforms
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

/**
 * The first gate, reported as a stage so the plan reads as the pipeline's own
 * first step rather than a dialog in front of it.
 */
function planStage(run: PipelineRun, plan: PipelinePlan): PipelineStage {
  const formats = plannedOutputs(plan).filter((output) => output.enabled).length;
  if (run.status === "planning") {
    return stage("running", `${formats} formats planned from this stream — change anything, then start the run.`);
  }
  return stage("ready", describePlan(plan));
}

function sourceStage(run: PipelineRun): PipelineStage {
  if (run.status === "planning") return stage("waiting", "Nothing is fetched until the plan is approved.");
  if (run.status === "error") return stage("error", run.error ?? "Ingest failed.");
  if (run.status === "ingesting") return stage("running", "Downloading the stream…", run.progress);
  const length = run.durationSec ? ` · ${formatDuration(run.durationSec)}` : "";
  return stage("ready", `${run.fileName ?? "Source"}${length}`);
}

function longformStage(run: PipelineRun, plan: PipelinePlan, project: LongformProject | undefined): PipelineStage {
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
  if (!plan.longform && !record) {
    return stage("skipped", "The plan left the export out — the edit is ready in the Long-Form Editor.");
  }
  if (!record && !rendersApproved(run)) return stage("waiting", "Edit planned — the export starts when you approve.");
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
  plan: PipelinePlan,
  project: LongformProject | undefined,
  rendered: number
): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (!plan.segments) return stage("skipped", "The plan left this stream whole — no topic segments.");
  if (project?.status === "error") return stage("skipped", "Needs the transcript, and analysis failed.");
  if (!project || project.status === "processing") return stage("waiting", "Split from the transcript once analysis finishes.");
  const topics = project.topics;
  if (!topics) {
    return stage("running", project.topicsNote ? "Waiting on the full transcript…" : "Reading the transcript for subjects…");
  }
  if (topics.length === 0) {
    return stage("skipped", project.topicsNote ?? "This recording reads as one continuous topic.");
  }
  const renderedNote = rendered > 0 ? ` · ${rendered} rendered` : "";
  return stage("ready", `${topics.length} topic segment${topics.length === 1 ? "" : "s"} ready to render${renderedNote}`);
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
  if (job.stage === "review") {
    const picked = job.clips.length;
    return stage(
      "waiting",
      `${picked} moment${picked === 1 ? "" : "s"} picked and titled — rendering starts when you approve.`
    );
  }
  const labels: Record<string, string> = {
    downloading: "Reading the source…",
    analyzing: "Transcribing…",
    selecting: "Picking the best moments…",
    rendering: ready > 0 ? `Rendering clips — ${ready} ready so far…` : "Rendering clips…"
  };
  return stage("running", labels[job.stage] ?? "Working…", job.progress);
}

function audioStage(run: PipelineRun, plan: PipelinePlan, project: LongformProject | undefined): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (!plan.audio) return stage("skipped", "No MP3 in the plan.");
  const record = project?.exports.find((item) => item.id === run.longformExportId);
  if (project?.status === "error") return stage("skipped", "Needs the long-form edit, which failed.");
  if (!record && !rendersApproved(run)) return stage("waiting", "Cut from the edited video once you approve the renders.");
  if (!record || record.status === "processing") return stage("waiting", "Cut from the edited video once it renders.");
  if (record.status === "done" && record.audioFile) return stage("ready", "Podcast MP3 extracted from the edit");
  if (record.status === "done") return stage("running", "Extracting the MP3…");
  return stage("skipped", "Needs the long-form edit, which failed.");
}

function imagesStage(
  run: PipelineRun,
  plan: PipelinePlan,
  project: LongformProject | undefined,
  slideCount: number
): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (plan.carouselSlides === 0 && !run.carouselId) return stage("skipped", "No carousel in the plan.");
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

function visualsStage(run: PipelineRun, plan: PipelinePlan, job: ClipJob | undefined, ready: boolean): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (!plan.visualAd) return stage("skipped", "No visual ad brief in the plan.");
  if (!job) return stage("waiting", "Waiting for the clip analysis.");
  if (ready) return stage("ready", "Best transcript moment ready for a realistic screenshot ad");
  if (job.status === "error") return stage("skipped", "No strong transcript moment was available.");
  return stage("waiting", "Choosing the strongest transcript moment and frame.");
}

function postsStage(run: PipelineRun, plan: PipelinePlan): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (plan.postPlatforms.length === 0 && !run.posts?.length) return stage("skipped", "No text posts in the plan.");
  if (run.posts && run.posts.length > 0) {
    const note = run.postsNote ? ` (${run.postsNote})` : "";
    return stage("ready", `${run.posts.length} text posts written${note}`);
  }
  if (run.posts) return stage("skipped", run.postsNote ?? "Nothing to write from.");
  return stage("waiting", "Written from the transcript and clip titles once they exist.");
}

/**
 * The second gate. Every selection this run is going to make is written by the
 * time it turns ready; approving it is what releases the renders. Reported as
 * `running` while it waits, because the run genuinely is not finished — it is
 * standing at this step.
 */
function reviewStage(run: PipelineRun, review: PipelineReview | undefined): PipelineStage {
  if (run.autoApprove) return stage("skipped", "Unattended run — it approves itself.");
  if (run.status === "planning") return stage("waiting", "The written selections land here before anything renders.");
  if (run.status === "error") return stage("skipped", "The run never got far enough to review.");
  if (run.outputsApprovedAt) return stage("ready", "Approved — rendering what you kept.");
  if (!review) return stage("waiting", "The written selections land here before anything renders.");
  if (!review.ready) return stage("running", `Still writing: ${review.pending.join(", ")}…`);
  return stage("running", "Everything is written. Check it over, then start the renders.");
}

/**
 * Gathers what the second gate puts up for approval. Undefined for an
 * unattended run, and before the source exists there is nothing to show.
 */
function buildReview(
  run: PipelineRun,
  plan: PipelinePlan,
  project: LongformProject | undefined,
  job: ClipJob | undefined,
  carouselHeadings: string[]
): PipelineReview | undefined {
  if (run.autoApprove || !run.sourceId) return undefined;

  const pending: string[] = [];
  const clipsPicked = Boolean(job && (job.stage === "review" || job.status === "done" || job.status === "error"));
  if (!clipsPicked) pending.push("clip moments");
  if (plan.segments && !project?.topics && project?.status !== "error") pending.push("topic segments");
  if (plan.carouselSlides > 0 && !run.carouselId && !run.carouselNote) pending.push("carousel slides");
  if (plan.postPlatforms.length > 0 && !run.posts) pending.push("text posts");

  return {
    ready: pending.length === 0,
    approvedAt: run.outputsApprovedAt,
    segments: (project?.topics ?? []).map((topic) => ({
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      start: topic.start,
      end: topic.end
    })),
    clips: (job?.clips ?? []).map((clip) => ({
      id: clip.id,
      title: clip.title ?? "Untitled moment",
      hookQuote: clip.hookQuote,
      start: clip.start,
      end: clip.end,
      score: clip.score
    })),
    carouselHeadings,
    posts: run.posts ?? [],
    pending
  };
}

/**
 * Joins the run with the live state of everything it references. Also
 * advances the run first, so polling the overview IS what drives the
 * pipeline forward.
 */
export async function runOverview(run: PipelineRun): Promise<PipelineRunOverview> {
  await advanceRun(run);

  const plan = runPlan(run);
  const project = run.longformProjectId ? await getProject(run.longformProjectId) : undefined;
  const job = run.clipJobId ? await getJob(run.clipJobId) : undefined;
  const exportRecord = project?.exports.find((item) => item.id === run.longformExportId);

  let slideCount = 0;
  let carouselHeadings: string[] = [];
  if (run.carouselId) {
    try {
      const data = await readAppData();
      const carousel = (data.videoStudio ?? defaultVideoStudio).carousels.find((c) => c.id === run.carouselId);
      slideCount = carousel?.slides.length ?? 0;
      carouselHeadings = (carousel?.slides ?? []).map((slide) => slide.heading);
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

  const topics = project?.topics ?? [];
  const segmentsRendered = topics.filter((topic) =>
    project?.exports.some((item) => item.topicId === topic.id && item.status === "done" && item.file)
  ).length;

  const review = buildReview(run, plan, project, job, carouselHeadings);

  const stages = {
    plan: planStage(run, plan),
    source: sourceStage(run),
    longform: longformStage(run, plan, project),
    segments: segmentsStage(run, plan, project, segmentsRendered),
    clips: clipsStage(run, job),
    audio: audioStage(run, plan, project),
    images: imagesStage(run, plan, project, slideCount),
    visuals: visualsStage(run, plan, job, Boolean(visualMoment)),
    posts: postsStage(run, plan),
    review: reviewStage(run, review),
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
  // `review` is in this list on purpose: a run standing at the gate has not
  // finished, and the channel scan's wait must not read it as done.
  const upstreamSettled = (
    ["longform", "segments", "clips", "audio", "images", "visuals", "posts", "review"] as const
  ).every((key) => stages[key].status !== "running" && stages[key].status !== "waiting");
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
    plan,
    review,
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
