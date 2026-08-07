import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { createJobFromUpload, getJob } from "@/lib/clipping/jobs";
import { readSourceMeta, saveSourceFromUrl } from "@/lib/clipping/sources";
import type { ClipJob } from "@/lib/clipping/types";
import { isExportRendering, startLongformExport } from "@/lib/longform/render";
import { createProject, getProject, planProjectTopics, projectOutputDir, updateProject } from "@/lib/longform/store";
import type { LongformProject } from "@/lib/longform/types";
import { generateLongformMetadata, longformMetadataConfigured } from "@/lib/longform/metadata";
import { generatePipelinePosts } from "@/lib/pipeline/posts";
import { repairableStages } from "@/lib/pipeline/repairable";
import { nextSegmentToRender, segmentsRenderable } from "@/lib/pipeline/segments";
import { podcastConfigured, publishEpisode } from "@/lib/podcast/publish";
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
import { MAX_IMAGES_PER_POST } from "@/lib/publisher/images";
import { publishQueue } from "@/lib/publisher/queue";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { DEFAULT_SLIDE_COUNT, generateCarousel, illustrateFromRecording } from "@/lib/studio/carousel";

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

/** Patches a run and flushes it. Exported for `repair.ts`, which un-sticks stages. */
export async function updateRun(run: PipelineRun, patch: Partial<PipelineRun>) {
  await update(run, patch);
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
    // A step that finally worked is not a stuck one. Clearing the count here
    // (rather than in each caller) keeps the marker honest for free.
    if (run.failures?.[key]) {
      const { [key]: _cleared, ...rest } = run.failures;
      run.failures = rest;
      await persistRuns();
    }
  } catch (error) {
    const message = noticeText(error instanceof Error ? error.message : String(error));
    if (!run.notices.includes(message)) {
      run.notices.push(message);
      if (run.notices.length > MAX_NOTICES) run.notices.splice(0, run.notices.length - MAX_NOTICES);
    }
    run.failures = { ...run.failures, [key]: (run.failures?.[key] ?? 0) + 1 };
    if (onError) await onError(message);
    await persistRuns();
  } finally {
    inflight.delete(guard);
  }
}

/** A step that has failed this many times in a row is not going to work. */
const GIVE_UP_AFTER = 3;

function stuck(run: PipelineRun, key: string): boolean {
  return (run.failures?.[key] ?? 0) >= GIVE_UP_AFTER;
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
  // Stop hammering a step that has failed the same way three times — the stage
  // reports it as broken and a retry clears the count.
  if (!run.longformProjectId && !stuck(run, "longform")) {
    await step(run, "longform", async () => {
      const project = await createProject(sourceId, run.name);
      await update(run, { longformProjectId: project.id });
    });
  }
  if (!run.clipJobId && !stuck(run, "clips")) {
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
    } else if (!stuck(run, "export")) {
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

  // MP3 cut → push it to the podcast RSS feed Spotify reads. Spotify has no
  // upload API, so the feed IS the delivery: adding the episode here is the
  // whole automation, and Spotify pulls it on its next read of the feed.
  if (project && exportRecord?.audioFile && !run.podcastEpisodeId && !run.podcastNote) {
    if (!podcastConfigured()) {
      await update(run, {
        podcastNote:
          "The podcast feed has nowhere public to live yet — set the bucket's public address on the Podcast page, then publish this episode from there. The MP3 is on disk either way."
      });
    } else {
      void step(run, "podcast", async () => {
        // Show notes, before the episode goes in the feed. Publishing first and
        // describing later is why episodes shipped described by the raw stream
        // name — a feed is read once and cached, so the description has to be
        // right the first time. A failure here is not a reason to skip the
        // episode: it falls back to the name, exactly as before.
        const metadata =
          project.metadata ??
          (longformMetadataConfigured()
            ? await generateLongformMetadata(project)
                .then(async (written) => {
                  await updateProject(project.id, { metadata: written });
                  return written;
                })
                .catch(() => undefined)
            : undefined);
        const { episode } = await publishEpisode({
          filePath: path.join(projectOutputDir(project.id), exportRecord.audioFile!),
          title: exportRecord.title ?? metadata?.titles[0] ?? run.name,
          description: metadata?.description ?? run.name,
          durationSec: exportRecord.durationSec ?? run.durationSec ?? 0,
          runId: run.id,
          projectId: project.id,
          exportId: exportRecord.id,
          link: run.sourceUrl
        });
        await update(run, { podcastEpisodeId: episode.id });
      }, async () => {
        // One shot, same as the extraction above: a feed push that fails on a
        // 2.5s poll would republish the notice forever. The episode can still
        // be added by hand from the Podcast page.
        await update(run, { podcastNote: "The episode could not be added to the podcast feed. Add it from the Podcast page." });
      });
    }
  }

  // The long-form analysis only transcribes the opening of a long stream (the
  // hook is all it needs), while the clip job transcribes the whole thing.
  // Once that full transcript exists, plan the stream's topic segments from
  // it — the long-form project picks it up automatically because both sides
  // work from the same source id. One attempt is enough: the clip job writes
  // its transcript once.
  if (
    project &&
    project.status === "ready" &&
    !project.topics &&
    !run.segmentsPlanned &&
    !stuck(run, "segments") &&
    job?.sourceCaptions?.length
  ) {
    void step(run, "segments", async () => {
      await planProjectTopics(project.id);
      await update(run, { segmentsPlanned: true });
    });
  }

  // "Render them all" is drained here rather than by whoever pressed the
  // button: the export engine takes one render at a time, so each finished
  // segment lets the next one start on the next poll, with the app closed or
  // open. The flag clears itself when there is nothing left.
  if (project && run.renderAllSegments) {
    // Cleared when nothing is left that COULD render, not merely when nothing
    // is left unrendered: a segment that fails twice is given up on, and the
    // instruction has to end with it or the loop never stops.
    if (segmentsRenderable(project) === 0) {
      await update(run, { renderAllSegments: undefined });
    } else {
      const next = nextSegmentToRender(project);
      if (next) {
        void step(run, `segment:${next.id}`, async () => {
          await startLongformExport(project, { topicId: next.id });
        });
      }
    }
  }

  // Transcript ready → write the carousel images copy from it. `carouselNote`
  // doubles as the "already tried and failed" marker: without it this step
  // would re-run on every poll, and each attempt now costs three model calls.
  if (project && project.status === "ready" && !run.carouselId && !run.carouselNote) {
    const transcriptText = project.transcript.map((segment) => segment.text).join(" ");
    if (speechWordCount(transcriptText) < MIN_SPEECH_WORDS) {
      if (project.transcript.length > 0) {
        await update(run, {
          carouselNote: "No speech was transcribed from this stream to write slides from.",
          carouselGaveUp: false
        });
      }
    } else if (!stuck(run, "carousel")) {
    void step(run, "carousel", async () => {
      const { carousel, drafts, reason } = await generateCarousel({
        title: run.name,
        sourceText: transcriptText,
        slideCount: DEFAULT_SLIDE_COUNT,
        sourceType: "longform",
        sourceId: project.id,
        imageMode: "backdrop",
        transcript: project.sourceId ? project.transcript : undefined,
        // Nobody is watching this one. Transcript-sliced slides would be
        // counted as "ready to schedule" and could reach a queue unread.
        requireModel: true
      });
      if (!carousel) {
        await update(run, { carouselNote: reason ?? "No carousel slides were written.", carouselGaveUp: true });
        return;
      }
      // The slides are then illustrated with stills from the stream itself,
      // each cut at the moment its copy is about, so the deck reads as the
      // video it was written from rather than eight gradients. Failing to take
      // them is not a reason to skip the carousel — the copy still stands.
      const illustrated = project.sourceId
        ? await illustrateFromRecording({
            carousel,
            drafts,
            sourceId: project.sourceId,
            transcript: project.transcript
          }).catch(() => ({ carousel, note: null }))
        : { carousel, note: null };
      const data = await readAppData();
      const studio = data.videoStudio ?? defaultVideoStudio;
      await writeAppData({
        ...data,
        videoStudio: { ...studio, carousels: [illustrated.carousel, ...studio.carousels] }
      });
      await update(run, {
        carouselId: carousel.id,
        carouselNote: [reason, illustrated.note].filter(Boolean).join(" ") || undefined
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
    await update(run, {
      posts: [],
      postsNote: "No speech was transcribed from this stream to write posts from.",
      postsGaveUp: false
    });
  }
  if (!run.posts && longformSettled && clipsSettled && hasMaterial && (project || job) && !stuck(run, "posts")) {
    void step(run, "posts", async () => {
      const { posts, reason } = await generatePipelinePosts({
        streamTitle: run.name,
        transcriptText,
        clipHighlights: (job?.clips ?? [])
          .filter((clip) => clip.title)
          .map((clip) => ({ title: clip.title!, quote: clip.hookQuote }))
      });
      await update(run, { posts, postsNote: reason ?? undefined, postsGaveUp: posts.length === 0 ? true : undefined });
    });
  }
}

// ----- Overview: the joined, per-stage view the pipeline page renders -----

function stage(status: PipelineStageStatus, detail: string, progress?: number): PipelineStage {
  return { status, detail, progress };
}

/**
 * A stage that tried and gave up. Distinct from `stage("skipped", …)`, which is
 * a skip BY DESIGN — nothing to write from, nothing to split, no audio track —
 * where a retry only spends model calls to reach the same answer.
 */
function gaveUp(detail: string): PipelineStage {
  return { status: "skipped", detail, retryable: true };
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
  if (!project) {
    if (run.longformProjectId) {
      // Deleted, not broken. A Retry can only ever answer "it is gone", so the
      // row says what to do instead of offering a button that always refuses.
      return { ...stage("error", "The long-form project is gone — remove this run, or start the stream again."), retryable: false };
    }
    // Without this a source that has been deleted under a run left the stage
    // saying "Creating the long-form project…" for good, retrying the same
    // doomed call every couple of seconds with no way to act on it.
    if (stuck(run, "longform")) {
      return { ...stage("error", run.notices[run.notices.length - 1] ?? "The long-form project could not be created."), retryable: true };
    }
    return stage("running", "Creating the long-form project…");
  }
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
  if (!record) {
    if (stuck(run, "export")) {
      return { ...stage("error", run.notices[run.notices.length - 1] ?? "The export could not be started."), retryable: true };
    }
    return stage("running", "Edit planned — starting the export…");
  }
  if (record.status === "processing") return stage("running", "Rendering the edited video…", record.progress);
  if (record.status === "done" && record.file) {
    const length = record.durationSec ? ` · ${formatDuration(record.durationSec)}` : "";
    return stage("ready", `Edited video rendered${length}`);
  }
  return stage("error", record.error ?? "The export failed.");
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
    if (stuck(run, "segments")) {
      return { ...stage("error", "The stream could not be split into subjects."), retryable: true };
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
  if (!job) {
    if (run.clipJobId) {
      return { ...stage("error", "The clip job is gone — remove this run, or start the stream again."), retryable: false };
    }
    if (stuck(run, "clips")) {
      return { ...stage("error", run.notices[run.notices.length - 1] ?? "The clip job could not be created."), retryable: true };
    }
    return stage("running", "Creating the clip job…");
  }
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
  // `hasAudio === false` is a recording with no sound at all: there is no MP3
  // to cut and never will be. Anything else means the extraction itself failed.
  if (run.audioNote) return project?.hasAudio === false ? stage("skipped", run.audioNote) : gaveUp(run.audioNote);
  if (record.status === "done") return stage("running", "Extracting the MP3…");
  return stage("skipped", "Needs the long-form edit, which failed.");
}

function podcastStage(run: PipelineRun, project: LongformProject | undefined): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (run.podcastEpisodeId) return stage("ready", "In the podcast feed — Spotify picks it up on its next read");
  if (run.podcastNote) return stage("skipped", run.podcastNote);
  if (run.audioNote) return stage("skipped", "No MP3 to publish.");
  const record = project?.exports.find((item) => item.id === run.longformExportId);
  if (record?.audioFile) return stage("running", "Adding the episode to the feed…");
  if (project?.status === "error") return stage("skipped", "Needs the long-form edit, which failed.");
  return stage("waiting", "Published to the feed once the MP3 is cut.");
}

function imagesStage(run: PipelineRun, project: LongformProject | undefined, slideCount: number): PipelineStage {
  if (run.status !== "running") return stage("waiting", "Waiting for the source.");
  if (run.carouselId) {
    // No slides behind the id means the carousel was deleted from the Studio.
    // Reporting DEFAULT_SLIDE_COUNT here claimed "8 carousel slides written"
    // for a carousel that no longer exists — the same phrasing the clips stage
    // uses for a missing job, since the count is best-effort and a failed read
    // looks identical to a deletion.
    if (slideCount === 0) {
      return { ...stage("error", "The carousel is gone — it was deleted from the Studio."), retryable: false };
    }
    const note = run.carouselNote ? ` (${run.carouselNote})` : "";
    return stage("ready", `${slideCount} carousel slides written${note}`);
  }
  // Attempted and gave up: a note with no carousel. Reported as skipped, never
  // as ready — there is nothing here anyone should schedule. Worth retrying
  // only when there was something to write from in the first place.
  if (run.carouselNote) {
    return run.carouselGaveUp ? gaveUp(run.carouselNote) : stage("skipped", run.carouselNote);
  }
  if (project?.status === "error") return stage("skipped", "Needs the transcript, and analysis failed.");
  if (project?.status === "ready" && project.transcript.length === 0) {
    return stage("skipped", "No transcript came out of this stream to write slides from.");
  }
  if (project?.status === "ready") {
    if (stuck(run, "carousel")) {
      return { ...stage("error", "The carousel could not be written."), retryable: true };
    }
    return stage("running", "Writing carousel slides from the transcript…");
  }
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
  if (run.posts) {
    const note = run.postsNote ?? "Nothing to write from.";
    return run.postsGaveUp ? gaveUp(note) : stage("skipped", note);
  }
  if (stuck(run, "posts")) {
    return { ...stage("error", "The text posts could not be written."), retryable: true };
  }
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
    podcast: podcastStage(run, project),
    images: imagesStage(run, project, slideCount),
    visuals: visualsStage(run, job, Boolean(visualMoment)),
    posts: postsStage(run),
    schedule: stage("waiting", "")
  };

  // What the Schedule button can actually book, and what it cannot. The deck is
  // one of them now — its slides are rendered to PNGs and booked as a picture
  // post — but only up to the picture-post ceiling; a longer deck still has to
  // be split by hand. The visual ad is composed in the browser from a frame
  // nobody has chosen yet, so it has no file to book.
  // Exactly what "Schedule everything from this run" books — the text posts have
  // their own button, and counting them here made the sentence overstate by N.
  const carouselBookable = slideCount > 0 && slideCount <= MAX_IMAGES_PER_POST;
  const bookable = clipsReady + (longformReady ? 1 : 0) + segmentsRendered + (carouselBookable ? 1 : 0);
  const byHand = (slideCount > 0 && !carouselBookable ? 1 : 0) + (visualMoment ? 1 : 0);
  const readyItems = bookable + byHand + (audioReady ? 1 : 0);
  const upstreamSettled = (["longform", "segments", "clips", "audio", "podcast", "images", "visuals", "posts"] as const).every(
    (key) => stages[key].status !== "running" && stages[key].status !== "waiting"
  );
  if (run.status === "error") {
    stages.schedule = stage("error", "Nothing reached the scheduler — the source never ingested.");
  } else if (readyItems === 0) {
    stages.schedule = stage("waiting", "Outputs land here as each one finishes.");
  } else {
    stages.schedule = stage(
      upstreamSettled ? "ready" : "running",
      // The podcast episode is reported separately because it is not waiting on
      // anyone: it is already in the feed, and nothing about it gets scheduled.
      [
        `${bookable} output${bookable === 1 ? "" : "s"} ready to schedule`,
        posts > 0 ? `${posts} text post${posts === 1 ? "" : "s"}` : "",
        byHand > 0 ? `${!carouselBookable && slideCount > 0 ? `${slideCount}-slide carousel` : ""}${
          !carouselBookable && slideCount > 0 && visualMoment ? " and " : ""
        }${visualMoment ? "visual ad" : ""} to post by hand` : "",
        queued > 0 ? `${queued} already queued` : "",
        run.podcastEpisodeId ? "podcast episode published" : ""
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }

  // An export record still marked `processing` in a process that is not
  // rendering it was abandoned by a restart: it will never finish and never
  // fail, so the stage says "Rendering…" forever unless someone is told.
  const longformStalled = Boolean(
    exportRecord && exportRecord.status === "processing" && !isExportRendering(exportRecord.id)
  );

  return {
    run,
    stages,
    retryable: run.status === "error" ? [] : repairableStages(stages, { longformStalled }),
    visualMoment,
    schedulable: {
      clipsReady,
      longformReady,
      segments: topics.length,
      segmentsRendered,
      audioReady,
      podcastPublished: Boolean(run.podcastEpisodeId),
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
