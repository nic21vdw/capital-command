import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { TARGET_CLIP_COUNT, detectSilences, extractEnergy, fallbackCandidates, selectCandidates } from "@/lib/clipping/analysis";
import { buildAss, buildClipTitleDialogue, chunkWords, windowSegments } from "@/lib/clipping/captions";
import { generateClipTitle } from "@/lib/clipping/editor";
import { generateViralTitles } from "@/lib/clipping/titles";
import { copyClipsToDrive, driveDir } from "@/lib/clipping/drive";
import { downloadAudio, downloadSection, fetchVideoMeta } from "@/lib/clipping/download";
import { hasAudioStream, probeDimensions, probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { renderCaptionedVertical, renderPreviewAssets, renderSourceClip } from "@/lib/clipping/render";
import { readSourceMeta, sourceFilePath, type SourceMeta } from "@/lib/clipping/sources";
import { defaultCaptionStyle } from "@/lib/storage/schemas";
import { ensureClipThumbnail } from "@/lib/clipping/thumbnails";
import { fetchSourceCaptions } from "@/lib/clipping/transcription";
import { selectByTranscript } from "@/lib/clipping/transcript-select";
import { transcribeMedia } from "@/lib/clipping/whisper";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";

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
 * Renames a job (the project/stream title) and/or a single clip's title.
 * Returns the updated job, or `undefined` if the job is gone. Blank titles are
 * ignored for the project name (it must always have a label) and clear a clip's
 * custom title (falling back to the auto-derived headline).
 */
export async function renameJob(
  id: string,
  patch: { fileName?: string; clipId?: string; clipTitle?: string }
): Promise<ClipJob | undefined> {
  await loadJobs();
  const job = jobs.get(id);
  if (!job) return undefined;
  if (typeof patch.fileName === "string") {
    const trimmed = patch.fileName.trim();
    if (trimmed) job.fileName = trimmed;
  }
  if (patch.clipId) {
    const clip = job.clips.find((candidate) => candidate.id === patch.clipId);
    if (!clip) throw new Error("That clip is no longer part of this job.");
    const trimmed = (patch.clipTitle ?? "").trim();
    clip.title = trimmed || undefined;
  }
  await persistJobs();
  return job;
}

/**
 * Fetches (and caches) automatic captions for a job. Platform captions are
 * tried first for URL sources, with local Whisper transcription as a fallback
 * so every source with an audio track gets captions. Force re-fetch to
 * regenerate. Errors are stored on the job, not thrown, so a source that
 * truly can't be transcribed degrades gracefully to manual captioning.
 */
export async function fetchJobCaptions(id: string, force = false): Promise<ClipJob | undefined> {
  await loadJobs();
  const job = jobs.get(id);
  if (!job) return undefined;
  if (job.sourceCaptions && job.sourceCaptions.length > 0 && !force) return job;
  try {
    let segments;
    if (job.sourceId) {
      // Uploaded files have no platform captions — transcribe them locally.
      const meta = await readSourceMeta(job.sourceId);
      if (!meta) throw new Error("The uploaded source file for this job is gone. Upload the video again.");
      if (!meta.hasAudio) throw new Error("This video has no audio track, so there is nothing to transcribe.");
      segments = await transcribeMedia(sourceFilePath(meta), workDir(id));
    } else {
      // Reuse the audio the pipeline downloaded when it still exists;
      // fetchSourceCaptions re-downloads it otherwise.
      const result = await fetchSourceCaptions(
        job.sourceUrl,
        workDir(id),
        path.join(workDir(id), "source-audio.mp3")
      );
      segments = result.segments;
    }
    await update(job, { sourceCaptions: segments, captionsFetchedAt: new Date().toISOString(), captionsError: undefined });
  } catch (error) {
    await update(job, { captionsError: error instanceof Error ? error.message : String(error) });
  }
  return job;
}

async function failJob(job: ClipJob, error: unknown) {
  await update(job, { status: "error", error: error instanceof Error ? error.message : String(error) });
}

function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }) {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union > 0 ? inter / union : 0;
}

function mergeClipCandidates(primary: ClipCandidate[], supplemental: ClipCandidate[]) {
  const merged: ClipCandidate[] = [];
  for (const candidate of [...primary, ...supplemental]) {
    if (merged.length >= TARGET_CLIP_COUNT) break;
    if (merged.some((existing) => overlapRatio(existing, candidate) > 0.45)) continue;
    merged.push(candidate);
  }
  for (const candidate of supplemental) {
    if (merged.length >= TARGET_CLIP_COUNT) break;
    if (merged.some((existing) => Math.abs(existing.start - candidate.start) < 1)) continue;
    merged.push(candidate);
  }
  return merged.slice(0, TARGET_CLIP_COUNT).map((candidate, index) => ({ ...candidate, id: `clip-${index + 1}` }));
}

/** A clip's transcript, windowed to clip-local time. */
function clipCaptions(job: ClipJob, clip: ClipCandidate) {
  return windowSegments(job.sourceCaptions ?? [], clip.start, clip.end);
}

/**
 * Gives every freshly selected clip a publish-ready title. One Claude call
 * writes viral, keyword-aware titles for the whole batch (see titles.ts for
 * the style guide); clips the model missed — or every clip when the call is
 * unavailable — fall back to the local heuristic titler, and failing that keep
 * any title the moment-selection pass proposed. Raw transcript fragments are
 * never used as titles.
 */
async function assignClipTitles(job: ClipJob) {
  if (job.clips.length === 0) return;
  const excerpts = new Map(job.clips.map((clip) => [clip.id, clipCaptions(job, clip)]));
  const requests = job.clips
    .map((clip) => ({
      id: clip.id,
      transcript: (excerpts.get(clip.id) ?? [])
        .map((segment) => segment.text)
        .join(" ")
        .trim()
    }))
    .filter((request) => request.transcript.length > 0);
  const viral =
    requests.length > 0
      ? await generateViralTitles(requests, { streamTitle: job.fileName, topic: job.topic })
      : null;
  for (const clip of job.clips) {
    const generated = viral?.get(clip.id);
    if (generated) clip.title = generated;
    else if (!clip.title) clip.title = generateClipTitle(excerpts.get(clip.id) ?? [], "") || undefined;
  }
  await persistJobs();
}

export async function createJobFromUrl(
  url: string,
  topic: string | undefined
): Promise<ClipJob> {
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

/** Creates a clip job from a previously uploaded source file. */
export async function createJobFromUpload(sourceId: string, topic: string | undefined): Promise<ClipJob> {
  await loadJobs();
  const meta = await readSourceMeta(sourceId);
  if (!meta) throw new Error("That uploaded video could not be found. Upload it again.");
  const id = crypto.randomUUID().slice(0, 8);
  const job: ClipJob = {
    id,
    fileName: meta.fileName,
    topic: topic || undefined,
    sourceUrl: `upload://${sourceId}`,
    sourceId,
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

  void runLocalPipeline(job, meta).catch((error) => failJob(job, error));
  return job;
}

/**
 * The pipeline for an uploaded file mirrors the URL pipeline, with ffmpeg
 * standing in for yt-dlp: extract the audio, transcribe it locally with
 * Whisper (word-level timing for the editor's synced captions), pick the best
 * moments from the transcript — falling back to whole-stream audio energy —
 * then cut and render each range from the local file.
 */
async function runLocalPipeline(job: ClipJob, meta: SourceMeta) {
  await update(job, { status: "processing", stage: "downloading", progress: 5 });
  const srcPath = sourceFilePath(meta);
  const durationSec = meta.durationSec || (await probeDuration(srcPath));
  if (durationSec < 20) {
    throw new Error("That video is shorter than 20 seconds — pick a longer recording to clip from.");
  }
  await update(job, { durationSec: Math.round(durationSec) });

  const audioPresent = await hasAudioStream(srcPath).catch(() => false);
  let audioPath: string | null = null;
  if (audioPresent) {
    audioPath = path.join(workDir(job.id), "source-audio.mp3");
    await runFfmpeg(["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath]);
  }
  // Start the same full-audio silence pass the Long-Form Editor uses while
  // transcription runs. The result is persisted for every clip, even when
  // transcript selection already finds all ten candidates.
  const silencePromise = audioPath
    ? detectSilences(audioPath).catch(() => [])
    : Promise.resolve([]);

  // Transcribe the upload locally so captions, titles, and moment selection
  // all work exactly like they do for platform VODs.
  await update(job, { stage: "analyzing", progress: 20 });
  let transcript: ClipJob["sourceCaptions"] = [];
  if (audioPath) {
    try {
      transcript = await transcribeMedia(audioPath, workDir(job.id));
      if (transcript.length > 0) {
        await update(job, {
          sourceCaptions: transcript,
          captionsFetchedAt: new Date().toISOString(),
          captionsError: undefined
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.notices.push(`Automatic captions unavailable: ${message}`);
      await update(job, { captionsError: message });
    }
  }

  const silences = await silencePromise;
  job.silences = silences;
  await update(job, { stage: "selecting", progress: 42 });
  let candidates: ClipCandidate[] | null = null;
  if (transcript && transcript.length > 0) {
    candidates = await selectByTranscript(transcript, durationSec, job.topic);
  }
  if (!candidates || candidates.length < TARGET_CLIP_COUNT) {
    if (audioPath) {
      const windows = await extractEnergy(audioPath);
      const energyCandidates = selectCandidates(windows, silences, durationSec, transcript ?? []);
      candidates =
        candidates && candidates.length > 0 ? mergeClipCandidates(candidates, energyCandidates) : energyCandidates;
      if (!transcript || transcript.length === 0) {
        job.notices.push("No transcript was available — moments were picked from whole-stream audio energy instead.");
      }
    } else {
      candidates = fallbackCandidates(durationSec, "This video has no audio track");
    }
  }
  job.clips = candidates;
  await persistJobs();

  // Title every clip before rendering so the ready-to-post render burns the
  // real title in, not a placeholder.
  await assignClipTitles(job);

  await renderClipIndexes(
    job,
    job.clips.map((_, index) => index)
  );
  await update(job, { status: "done", stage: "finished", progress: 100 });
}

/** Cuts [start, end] out of a local file with a fast keyframe seek + stream copy. */
async function cutLocalSection(srcPath: string, start: number, end: number, destPath: string): Promise<string> {
  await runFfmpeg([
    "-y",
    "-ss",
    Math.max(0, start).toFixed(2),
    "-i",
    srcPath,
    "-t",
    Math.max(0.1, end - start).toFixed(2),
    "-c",
    "copy",
    destPath
  ]);
  return destPath;
}

/**
 * The whole pipeline for a pasted VOD URL:
 *   1. Download just the audio (fast even for multi-hour streams).
 *   2. Read the FULL transcript and pick the best moments from anywhere in the
 *      stream (Claude), falling back to whole-stream energy analysis offline.
 *   3. Fetch each chosen range and render it as a neutral 16:9 source clip in parallel.
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
  const silencePromise = detectSilences(audioPath).catch(() => []);
  const durationSec = meta.durationSec || (await probeDuration(audioPath));
  await update(job, { durationSec: Math.round(durationSec) });

  // 2. Read the whole transcript and pick the best moments from across the
  //    entire stream. Captions double as the editor's source captions.
  await update(job, { stage: "analyzing", progress: 30 });
  let transcript: ClipJob["sourceCaptions"] = [];
  try {
    // Platform captions first, local Whisper transcription of the audio we
    // just downloaded as a fallback — a source without platform captions
    // still gets automatic captions.
    const result = await fetchSourceCaptions(url, workDir(job.id), audioPath);
    transcript = result.segments;
    if (result.source === "local") {
      job.notices.push(
        "This source has no platform captions, so captions were generated locally with on-device transcription."
      );
    }
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

  const silences = await silencePromise;
  job.silences = silences;
  await update(job, { stage: "selecting", progress: 42 });
  let candidates: ClipCandidate[] | null = null;
  if (transcript && transcript.length > 0) {
    candidates = await selectByTranscript(transcript, durationSec, job.topic);
  }

  if (!candidates || candidates.length < TARGET_CLIP_COUNT) {
    // Score moments from audio energy across the whole stream. We still pass the transcript (if any) so scoring
    // can read what is said, not just how loud it is.
    const windows = await extractEnergy(audioPath);
    const energyCandidates = selectCandidates(windows, silences, durationSec, transcript ?? []);
    candidates = candidates && candidates.length > 0 ? mergeClipCandidates(candidates, energyCandidates) : energyCandidates;
    if (!transcript || transcript.length === 0) {
      job.notices.push(
        "No transcript was available for this source — picked moments from whole-stream audio energy instead."
      );
    }
  }
  job.clips = candidates;
  await persistJobs();

  // Title every clip before rendering so the ready-to-post render burns the
  // real title in, not a placeholder.
  await assignClipTitles(job);

  await renderClipIndexes(
    job,
    job.clips.map((_, index) => index)
  );

  // Optionally mirror the finished clips into a Google Drive-synced folder.
  // No API or sign-in: this just copies files into a local folder that Google
  // Drive for Desktop syncs (see CLIPS_DRIVE_DIR in .env). Off unless set.
  if (driveDir()) {
    const rendered = job.clips
      .filter((clip) => clip.downloadFile || clip.file)
      .map((clip) => {
        // Mirror the ready-to-post download clip when it rendered, else the master.
        const fileName = (clip.downloadFile ?? clip.file) as string;
        return { sourcePath: path.join(outputDir(job.id), fileName), fileName };
      });
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

// The ready-to-post download clip is composed at 9:16 (1080x1920), matching a
// fresh editor project's default vertical export.
const DOWNLOAD_FRAME_W = 1080;
const DOWNLOAD_FRAME_H = 1920;

/**
 * Writes the ASS document burned into a clip's ready-to-post download render:
 * the clip's word-synced captions, windowed to the clip range and styled like a
 * fresh editor project, plus the clip's title in white just above the centered
 * video (over the blurred fill), and returns its path. No watermark is burned —
 * the clip ships clean, matching the editor's watermark-off default.
 * `sourceDims` are the input video's pixel dimensions, used to find the video
 * band's top edge; a 16:9 source is assumed when not provided.
 */
async function writeClipDownloadAss(
  job: ClipJob,
  clip: ClipCandidate,
  index: number,
  sourceDims?: { width: number; height: number }
): Promise<string> {
  const style = defaultCaptionStyle;
  // Window the source captions into clip-local time, then re-chunk the words the
  // same way the editor does so the burned captions match what opening the clip
  // in the editor would show.
  const windowed = windowSegments(job.sourceCaptions ?? [], clip.start, clip.end);
  const words = windowed.flatMap((segment) => segment.words);
  const captions = words.length ? chunkWords(words, style.maxWordsPerCaption) : windowed;
  const captionDoc = buildAss(captions, style, DOWNLOAD_FRAME_W, DOWNLOAD_FRAME_H, true);
  // Every clip ships with its title burned in by default. Top edge of the
  // contain-fitted video: the source is scaled to the frame width, so its
  // on-frame height is frameW * (srcH/srcW), centered vertically.
  const srcW = sourceDims?.width || 16;
  const srcH = sourceDims?.height || 9;
  const videoHeightFrac = Math.min(1, (DOWNLOAD_FRAME_W * (srcH / Math.max(1, srcW))) / DOWNLOAD_FRAME_H);
  const videoTopFrac = (1 - videoHeightFrac) / 2;
  const title = clip.title?.trim() || generateClipTitle(windowed, "");
  const titleLine = title
    ? `${buildClipTitleDialogue(title, DOWNLOAD_FRAME_W, DOWNLOAD_FRAME_H, 0, Math.max(0.1, clip.end - clip.start), videoTopFrac)}\n`
    : "";
  const assPath = path.join(workDir(job.id), `caps-${String(index + 1).padStart(2, "0")}.ass`);
  await writeFile(assPath, `${captionDoc}${titleLine}`, "utf8");
  return assPath;
}

/**
 * Records a finished Clip Editor export against the clip candidate it was cut
 * from, so the Clip Generator and the Uploading Center surface the edited clip
 * instead of the auto-generated render. No-op when the export's source master
 * doesn't belong to a known clip.
 */
export async function attachEditedClipRender(
  jobId: string,
  sourceFile: string,
  exportFile: string,
  signature?: string
) {
  await loadJobs();
  const job = jobs.get(jobId);
  const clip = job?.clips.find(
    (candidate) => candidate.file === sourceFile || candidate.variants?.some((variant) => variant.file === sourceFile)
  );
  if (!job || !clip) return;
  clip.editedFile = exportFile;
  clip.editedSignature = signature;
  clip.editedAt = new Date().toISOString();
  await persistJobs();
}

/**
 * Guarantees a Shorts-ready file for publishing: given any rendered file in a
 * job's output folder, returns the name of a 9:16 vertical version of it.
 * Vertical files pass through untouched; a widescreen file (e.g. the 16:9
 * master of an older job whose ready render never happened) is composed into
 * the standard centered + blurred-fill vertical — with the clip's word-synced
 * captions burned in when the file is a clip's neutral master.
 */
export async function ensureVerticalClipFile(jobId: string, fileName: string): Promise<string> {
  await loadJobs();
  const job = jobs.get(jobId);
  const filePath = path.join(outputDir(jobId), fileName);
  const dims = await probeDimensions(filePath);
  if (dims.height > dims.width) return fileName;

  const clip = job?.clips.find(
    (candidate) => candidate.file === fileName || candidate.downloadFile === fileName || candidate.editedFile === fileName
  );
  const isMaster = Boolean(clip && clip.file === fileName);

  // The clip may already have a vertical ready render — reuse it.
  if (clip && isMaster && clip.downloadFile) {
    const readyPath = path.join(outputDir(jobId), clip.downloadFile);
    const ready = await probeDimensions(readyPath).catch(() => null);
    if (ready && ready.height > ready.width) return clip.downloadFile;
  }

  const verticalName = `${path.parse(fileName).name}-vertical.mp4`;
  const verticalPath = path.join(outputDir(jobId), verticalName);
  const existing = await stat(verticalPath).catch(() => null);
  if (!existing || existing.size < 1024) {
    const audio = await hasAudioStream(filePath).catch(() => false);
    // Only the neutral master gets captions burned in; edited exports and
    // ready renders already carry theirs, and double-burning looks broken.
    let assPath: string | null = null;
    if (job && clip && isMaster) {
      assPath = await writeClipDownloadAss(job, clip, job.clips.indexOf(clip), dims).catch(() => null);
    }
    await renderCaptionedVertical(filePath, verticalPath, assPath, audio);
  }
  if (job && clip && isMaster && !clip.downloadFile) {
    clip.downloadFile = verticalName;
    await persistJobs();
  }
  return verticalName;
}

async function renderClipIndexes(job: ClipJob, indexes: number[]) {
  // Fetch each chosen range from the source and render a neutral 16:9 source clip. These are
  // network- and CPU-bound, so keep concurrency modest to avoid source throttles.
  let completed = 0;
  const total = indexes.length;
  const uploadMeta = job.sourceId ? await readSourceMeta(job.sourceId) : null;
  if (job.sourceId && !uploadMeta) {
    throw new Error("The uploaded source file for this job is gone. Upload the video again.");
  }
  const renderOne = async (i: number) => {
    const clip = job.clips[i];
    const segPath = path.join(workDir(job.id), `seg-${String(i + 1).padStart(2, "0")}.mp4`);
    try {
      const produced = uploadMeta
        ? await cutLocalSection(sourceFilePath(uploadMeta), clip.start, clip.end, segPath)
        : await downloadSection(job.sourceUrl, clip.start, clip.end, segPath);
      const baseName = `clip-${String(i + 1).padStart(2, "0")}`;
      const primaryName = `${baseName}.mp4`;
      // Publish an instant preview (faststart stream copy + poster frame)
      // BEFORE the slow HD render, so the clip is viewable in the UI the
      // moment its section exists. Best-effort: the HD render below is what
      // actually completes the clip.
      try {
        // Sections are almost always MP4; keep WebM sections in their own
        // container instead of forcing codecs into an MP4 remux.
        const previewExt = path.extname(produced).toLowerCase() === ".webm" ? ".webm" : ".mp4";
        const previewName = `${baseName}-preview${previewExt}`;
        const posterName = `${baseName}-poster.jpg`;
        await renderPreviewAssets(
          produced,
          path.join(outputDir(job.id), previewName),
          path.join(outputDir(job.id), posterName)
        );
        clip.previewFile = previewName;
        clip.posterFile = posterName;
        await persistJobs();
      } catch {
        // A failed preview never blocks the real render.
      }
      await renderSourceClip(produced, path.join(outputDir(job.id), primaryName), true);
      clip.file = primaryName;
      // Poster frame for the clip card; fire-and-forget so a thumbnail
      // hiccup never fails the render (the card falls back to lazy
      // generation via the thumbnail route).
      void ensureClipThumbnail(outputDir(job.id), primaryName);
      clip.layoutPreset = undefined;
      clip.variants = undefined;
      // The master was re-cut, so any earlier editor export no longer matches it.
      clip.editedFile = undefined;
      // Compose the ready-to-post download clip: centered 9:16 over a blurred
      // fill, with word-synced captions burned in (no watermark by default).
      // Clips must always ship Shorts-ready, so a caption failure falls back
      // to the same 9:16 composition without burned captions — never to the
      // widescreen master.
      try {
        const downloadName = `${baseName}-ready.mp4`;
        const downloadPath = path.join(outputDir(job.id), downloadName);
        try {
          const dims = await probeDimensions(produced).catch(() => undefined);
          const assPath = await writeClipDownloadAss(job, clip, i, dims);
          await renderCaptionedVertical(produced, downloadPath, assPath, true);
        } catch {
          await renderCaptionedVertical(produced, downloadPath, null, true);
        }
        clip.downloadFile = downloadName;
        await persistJobs();
      } catch {
        // Even the plain vertical render failed (ffmpeg trouble); the UI
        // falls back to the master and publishing re-renders on demand.
        job.notices.push(`Clip ${i + 1}: the 9:16 vertical render failed — it will be re-rendered when scheduled.`);
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
