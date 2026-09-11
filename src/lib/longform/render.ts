import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAss, buildClipTitleDialogue } from "@/lib/clipping/captions";
import {
  containScale,
  intermediateVideoArgs,
  masterAudioArgs,
  masterVideoArgs,
  resolveOutputFrame,
  scaleFilter
} from "@/lib/clipping/encode";
import { isRenderCanceled, probeVideoStream, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { animatedReframeChain } from "@/lib/clipping/render";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { getTrack, trackFilePath } from "@/lib/longform/music";
import { overlayFilePath } from "@/lib/longform/overlays";
import { editedDurationSec, exportRanges, projectForTopic, remapCaptionsToOutput, sourceTimeToOutput, sourceToOutputIntervals, type KeptRange } from "@/lib/longform/plan";
import { getProject, projectOutputDir, projectWorkDir, setTopicExport, updateProject, withFullTranscript } from "@/lib/longform/store";
import type { LongformExportRecord, LongformProject } from "@/lib/longform/types";
import { DEFAULT_OUTPUT_QUALITY, normalizeOutputQuality, type OutputQuality } from "@/lib/pipeline/outputQuality";
import { readAppData } from "@/lib/storage/store";
import { planSfxCues } from "@/lib/sfx/cues";
import { resolveSoundPath } from "@/lib/sfx/sounds";
import type { SfxSoundId } from "@/types/domain";
import { finalizeTitle } from "@/lib/title/finalize";

// The Long-Form Editor's export engine. The edited video is baked in stages:
//   1. Hook — the opening seconds re-rendered with the punch-in zoom and the
//      big word-synced captions burned in.
//   2. Body — one single-pass select render that keeps only the enabled
//      segments, cutting every stretch of dead space in one ffmpeg run.
//   3. Concat — hook + body joined losslessly (identical encode settings).
//   4. Burn-ins — timeline image overlays AND the whole-video captions drawn
//      over the joined edit in ONE pass (captions remapped through the cuts).
//   5. Audio — every placed timeline audio clip mixed under the edit, video
//      stream-copied.
//
// The picture is encoded exactly once at ship quality. Whichever of stages 1-2
// or stage 4 is last runs at the master CRF; anything before it that another
// filter pass will re-read is near-lossless (`intermediateVideoArgs`). Stages
// 3 and 5 never touch the picture at all. The frame itself comes from the
// recording — see `resolveExportFrame`, not a hardcoded 1920x1080.
// Export records persist on the project, so status survives a dev restart.

// How long the hook's punch-in zoom takes to ramp from 1x to the target zoom
// when opening motion is switched off — the original snap-in.
const HOOK_ZOOM_RAMP_SEC = 0.5;
// With opening motion on, the push runs across the WHOLE hook block instead:
// a continuous, decelerating 1x -> zoom drift over the 30 seconds a viewer
// decides in. Nothing moves after the block ends — the body pass has no zoom.
// The title card fades in at 0:00 and is gone by here.
const HOOK_TITLE_CARD_SEC = 3;
const HOOK_TITLE_FADE_MS = { in: 350, out: 500 };
/** Longest title burned onto the opening; anything more reads as a paragraph. */
const HOOK_TITLE_MAX_CHARS = 90;

// Both parts encode with identical codec/size/fps/audio settings so the
// concat demuxer can join them with a pure stream copy.
//
// The shared master (`encode.ts`) is medium / CRF 17 / AAC 320k. superfast
// at CRF 20 was the speed trade that softened screenshare text and the mix
// on a file that four platforms then re-encode. Encode time is the cost of
// keeping the original looking like the original.
const VIDEO_ENC = masterVideoArgs();
const AUDIO_ENC = masterAudioArgs();

// Streaming platforms play everything at roughly -14 LUFS. A raw stream edit
// lands nearer -25 dBFS mean, which sounds broken-quiet next to the video
// before it in a feed — and the podcast MP3 inherits exactly the same level.
// One-pass loudnorm on the FINAL mix (never per part, which would let the hook
// and the body settle at different levels and jump at the seam) is close enough
// and only costs an audio re-encode.
// TP sits at -2 rather than the usual -1: the AAC encode after this filter
// overshoots, and at -1.5 the finished file measured -0.1 dBFS true peak.
const LOUDNORM = "loudnorm=I=-14:TP=-2:LRA=11";

/** Escapes a filesystem path for use inside an ffmpeg filtergraph argument. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * The frame every stage of one export is locked to.
 *
 * `frameW`/`frameH` is what ships. `wideW`/`wideH` is the 16:9 stage the hook's
 * punch-in runs on before a vertical layout wraps it — on the wide layout the
 * two are the same frame.
 */
type ExportFrame = {
  frameW: number;
  frameH: number;
  wideW: number;
  wideH: number;
  fps: number;
  vertical: boolean;
};

/** The output quality remembered for the next stream, when a project carries none. */
async function settingsOutputQuality(): Promise<OutputQuality> {
  try {
    const data = await readAppData();
    return normalizeOutputQuality(data.settings.outputQuality);
  } catch {
    return { ...DEFAULT_OUTPUT_QUALITY };
  }
}

/**
 * Decides the export's frame from the recording itself.
 *
 * This used to be the constant 1920x1080 at 30 fps, which is what made a
 * long-form export look worse than the stream it came from: a 360p download was
 * upscaled to 1080p (paying CRF 17 for three times the pixels and none of the
 * detail) and a 60 fps recording was halved. The size and rate now come from
 * the source, with the owner's choice acting only as a ceiling.
 */
async function resolveExportFrame(project: LongformProject, srcPath: string): Promise<ExportFrame> {
  const quality = normalizeOutputQuality(project.output ?? (await settingsOutputQuality()));
  const probed = await probeVideoStream(srcPath).catch(() => null);
  const source = {
    width: probed?.width || project.width,
    height: probed?.height || project.height,
    fps: probed?.fps ?? 0
  };
  const vertical = (project.layout ?? "wide") === "vertical";
  const wide = resolveOutputFrame(source, quality, "wide");
  const frame = vertical ? resolveOutputFrame(source, quality, "vertical") : wide;
  return {
    frameW: frame.width,
    frameH: frame.height,
    wideW: wide.width,
    wideH: wide.height,
    fps: frame.fps,
    vertical
  };
}

/**
 * Wraps a stage's output into the 9:16 vertical frame: the picture scaled to
 * full width and centered over a blurred, dimmed cover fill of itself, so
 * nothing is cropped away — the same composition the Clip Generator's
 * vertical renders use. The background is blurred at quarter size (cheaper,
 * visually equivalent) and scaled back up.
 */
function verticalWrapChain(inLabel: string, outLabel: string, frameW: number, frameH: number): string {
  const bgW = Math.max(2, Math.round(frameW / 4) * 2);
  const bgH = Math.max(2, Math.round(frameH / 4) * 2);
  return (
    `[${inLabel}]split=2[__vwbg][__vwfg];` +
    `[__vwbg]scale=${bgW}:${bgH}:force_original_aspect_ratio=increase,crop=${bgW}:${bgH},` +
    `boxblur=12:2,eq=brightness=-0.08,scale=${frameW}:${frameH}[__vwbgb];` +
    `[__vwfg]${scaleFilter(frameW, -2)}[__vwfgs];` +
    `[__vwbgb][__vwfgs]overlay=(W-w)/2:(H-h)/2[${outLabel}]`
  );
}

/** Parses the `time=HH:MM:SS.cc` readout from an ffmpeg progress line. */
function parseProgressSeconds(line: string): number | null {
  const match = line.match(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

// Abort controllers for in-flight renders, so a long-form export can be
// stopped safely (each ffmpeg stage is killed and no later stage starts).
// Keyed by export record id; kept on globalThis so a dev hot-reload doesn't
// orphan a running render.
type RenderGlobal = typeof globalThis & { __longformExportControllers?: Map<string, AbortController> };
const rg = globalThis as RenderGlobal;
const controllers = (rg.__longformExportControllers ??= new Map<string, AbortController>());

/**
 * Whether this process is actually rendering that export right now. A record
 * left `processing` by a server that stopped mid-render has no controller, so
 * it will never finish and never fail — that pair is how a stalled export is
 * told apart from a slow one.
 */
export function isExportRendering(recordId: string): boolean {
  return controllers.has(recordId);
}

async function patchRecord(projectId: string, recordId: string, patch: Partial<LongformExportRecord>) {
  const project = await getProject(projectId);
  if (!project) return;
  const record = project.exports.find((item) => item.id === recordId);
  if (!record) return;
  // ffmpeg reports progress on every stderr line but the rounded percentage
  // rarely moves — skip no-op patches so a multi-hour render doesn't rewrite
  // the (large) projects file twice a second for its whole duration.
  const changed = (Object.keys(patch) as Array<keyof LongformExportRecord>).some((key) => record[key] !== patch[key]);
  if (!changed) return;
  Object.assign(record, patch);
  await updateProject(projectId, { exports: project.exports });
}

/**
 * Resolves what an export actually renders: the whole edit, or the project
 * clipped to one topic segment. Throws when a topic id no longer exists (the
 * segments were replanned since the export was requested).
 */
function exportTarget(project: LongformProject, topicId?: string): LongformProject {
  if (!topicId) return project;
  const topic = project.topics?.find((item) => item.id === topicId);
  if (!topic) {
    throw new Error("That segment is no longer part of this project — find the segments again and retry.");
  }
  return projectForTopic(project, topic);
}

/**
 * Starts rendering the edited video and returns the (processing) export
 * record immediately; the client polls the export route for progress.
 *
 * With `topicId` the render is one topic segment of the recording instead of
 * the whole edit: the same hook, cuts, captions and mix, over that segment's
 * window only.
 */
export async function startLongformExport(
  project: LongformProject,
  options: { topicId?: string } = {}
): Promise<LongformExportRecord> {
  if (project.status !== "ready") throw new Error("This project is still processing.");
  if (project.exports.some((record) => record.status === "processing")) {
    throw new Error("An export is already rendering for this project.");
  }
  const target = exportTarget(project, options.topicId);
  const { hookRange, bodyRanges } = exportRanges(target.segments, target.hook);
  if (!hookRange && bodyRanges.length === 0) {
    throw new Error(
      options.topicId
        ? "Nothing to export in that segment — every part of it is cut."
        : "Nothing to export — every segment is cut. Re-enable at least one segment."
    );
  }

  const recordId = crypto.randomUUID().slice(0, 8);

  // Shared post-processing step (same one the short-form pipeline uses): run
  // the project name through the emoji decorator and log the title for CTR
  // analysis. The project name is the best available content signal, so the
  // decorator keyword-matches it onto a category; with emoji disabled the
  // title is returned unchanged.
  const finalized = await finalizeTitle({
    baseTitle: target.name,
    category: target.name,
    pipelineType: "long",
    videoId: recordId
  });

  const record: LongformExportRecord = {
    id: recordId,
    status: "processing",
    progress: 1,
    durationSec: editedDurationSec(target.segments, target.hook),
    title: finalized.title,
    emojiUsed: finalized.emojiUsed,
    topicId: options.topicId,
    createdAt: new Date().toISOString()
  };
  // Keep the record list short; old files stay on disk until project delete.
  // Segment renders are kept alongside the full-edit ones, so a stream that
  // produced five segments does not push its own outputs off the list.
  const exports = [record, ...project.exports].slice(0, 12);
  await updateProject(project.id, { exports });
  if (options.topicId) await setTopicExport(project.id, options.topicId, recordId);

  const controller = new AbortController();
  controllers.set(record.id, controller);
  void runExport(project.id, record.id, controller.signal)
    .catch(async (error) => {
      // A deliberate stop is not a failure — cancelLongformExport already
      // flipped the record to "canceled".
      if (isRenderCanceled(error) || controller.signal.aborted) {
        await patchRecord(project.id, record.id, { status: "canceled", progress: 0, error: undefined });
        return;
      }
      await patchRecord(project.id, record.id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    })
    .finally(() => controllers.delete(record.id));
  return record;
}

/**
 * Stops an in-flight long-form render safely: aborts the ffmpeg stage, prevents
 * later stages from starting, and marks the record "canceled". A no-op once the
 * export has already finished, errored, or been stopped.
 */
export async function cancelLongformExport(
  projectId: string,
  recordId: string
): Promise<LongformExportRecord | null> {
  const project = await getProject(projectId);
  const record = project?.exports.find((item) => item.id === recordId);
  if (!record) return null;
  if (record.status !== "processing") return record;
  controllers.get(recordId)?.abort();
  controllers.delete(recordId);
  await patchRecord(projectId, recordId, { status: "canceled", progress: 0, error: undefined });
  const updated = await getProject(projectId);
  return updated?.exports.find((item) => item.id === recordId) ?? record;
}

async function runExport(projectId: string, recordId: string, signal: AbortSignal) {
  const stored = await getProject(projectId);
  if (!stored) throw new Error("Project is gone.");
  // A segment render works on the clipped view of the project. Re-deriving it
  // here (rather than passing it in) keeps the stored record the only source
  // of truth for what this export is.
  const topicId = stored.exports.find((item) => item.id === recordId)?.topicId;
  // A segment's hook captions are cut from the transcript at its own window,
  // which on a long stream is past everything the project stored.
  const source = topicId ? await withFullTranscript(stored) : stored;
  const project = exportTarget(source, topicId);
  const meta = await readSourceMeta(project.sourceId);
  if (!meta) throw new Error("The uploaded source file for this project is gone. Upload the video again.");
  const srcPath = sourceFilePath(meta);
  const workDir = projectWorkDir(projectId);
  const outDir = projectOutputDir(projectId);
  const { hookRange, bodyRanges } = exportRanges(project.segments, project.hook);
  const hasAudio = project.hasAudio;
  const frame = await resolveExportFrame(project, srcPath);
  const { frameW, frameH, wideW, wideH, fps, vertical } = frame;

  // The overlay and caption burn-ins used to be two more full re-encodes of the
  // whole edit, stacked on top of the hook/body encode: three generations of
  // x264 on the same frames. They are one filtergraph now, planned here because
  // knowing whether it will run is what decides how the parts are encoded — the
  // parts stay near-lossless when something re-encodes them afterwards, and are
  // themselves the single quality encode when nothing does.
  const burnIn = await planBurnIns(project, frame, workDir, recordId);
  const PART_ENC = burnIn ? intermediateVideoArgs() : VIDEO_ENC;

  const hookSec = hookRange ? hookRange.end - hookRange.start : 0;
  const bodySec = bodyRanges.reduce((sum, range) => sum + (range.end - range.start), 0);

  const report = (base: number, span: number, seconds: number, phaseTotal: number) =>
    void patchRecord(projectId, recordId, {
      progress: Math.min(base + span, base + Math.round((Math.min(seconds, phaseTotal) / Math.max(0.1, phaseTotal)) * span))
    }).catch(() => undefined);

  const parts: string[] = [];

  // 1. Hook: punch-in zoom on the focus point + burned-in viral captions.
  if (hookRange) {
    const hookPath = path.join(workDir, `export-${recordId}-hook.mp4`);
    let assArg = "";
    const motion = project.hook.motionEnabled !== false;
    const captions = project.hook.captionsEnabled ? project.hook.captions.filter((c) => c.enabled && c.text.trim()) : [];
    // The title card is part of the opening treatment, not part of the
    // captions, so it is burned even when hook captions are switched off.
    const titleText = motion ? project.name.trim().slice(0, HOOK_TITLE_MAX_CHARS) : "";
    const titleLine =
      titleText && hookSec > 1
        ? buildClipTitleDialogue(
            titleText,
            frameW,
            frameH,
            0,
            Math.min(HOOK_TITLE_CARD_SEC, hookSec - 0.2),
            0,
            HOOK_TITLE_FADE_MS
          )
        : "";
    if (captions.length > 0 || titleLine) {
      const assDoc = buildAss(captions, project.hook.captionStyle, frameW, frameH, project.hook.highlightCurrentWord);
      const assPath = path.join(workDir, `export-${recordId}-hook.ass`);
      await writeFile(assPath, titleLine ? `${assDoc}${titleLine}\n` : `${assDoc}\n`, "utf8");
      assArg = `ass='${escapeFilterPath(assPath)}',`;
    }
    // animatedReframeChain crops a zoomed cover of the frame around the focus
    // point, with a blurred fill behind so the punch-in never shows black
    // edges. With opening motion on, the 1x -> zoom ease-out is stretched
    // across the entire hook block, so the frame is drifting in for the whole
    // 30 seconds rather than snapping and sitting still. With it off the old
    // HOOK_ZOOM_RAMP_SEC punch-in is used, capped at half the hook so a short
    // hook still finishes the move before it ends.
    // On the vertical layout the punch-in still runs on the 16:9 frame, which
    // is then wrapped into the 9:16 frame; the captions burn over the full
    // vertical frame afterwards.
    const sx = project.hook.focusX * 2 - 1;
    const sy = project.hook.focusY * 2 - 1;
    const rampSec = motion ? Math.max(HOOK_ZOOM_RAMP_SEC, hookSec) : Math.min(HOOK_ZOOM_RAMP_SEC, Math.max(0.05, hookSec / 2));
    const reframe = animatedReframeChain("0:v", "vz", wideW, wideH, project.hook.zoom, sx, sy, rampSec, fps);
    const filter = vertical
      ? `${reframe};${verticalWrapChain("vz", "vv", frameW, frameH)};[vv]${assArg}fps=${fps},setsar=1,format=yuv420p[vout]`
      : `${reframe};[vz]${assArg}fps=${fps},setsar=1,format=yuv420p[vout]`;
    await runFfmpeg(
      [
        "-y",
        // Seek to the hook's source start (0 for a normal opening hook), then
        // take hookSec of footage — the hook window pulled to the front.
        "-ss",
        hookRange.start.toFixed(3),
        "-i",
        srcPath,
        "-t",
        hookSec.toFixed(3),
        "-filter_complex",
        filter,
        "-map",
        "[vout]",
        ...(hasAudio ? ["-map", "0:a?"] : []),
        ...PART_ENC,
        ...(hasAudio ? AUDIO_ENC : ["-an"]),
        hookPath
      ],
      { signal, onLine: (line) => {
          const seconds = parseProgressSeconds(line);
          if (seconds !== null) report(2, 8, seconds, hookSec);
        } }
    );
    parts.push(hookPath);
  }
  await patchRecord(projectId, recordId, { progress: 10 });

  // 2. Body: keep only the enabled ranges in a single select pass. Frames and
  // audio are re-stamped back-to-back, which is exactly the jump-cut edit.
  if (bodyRanges.length > 0) {
    const bodyPath = path.join(workDir, `export-${recordId}-body.mp4`);
    const expr = selectExpression(bodyRanges);
    const lastEnd = bodyRanges[bodyRanges.length - 1].end;
    // Wide fits the kept frames into 16:9 with letterbox padding; vertical
    // centers them at full width over a blurred fill of themselves.
    const filters = vertical
      ? [
          `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB[vsel]`,
          verticalWrapChain("vsel", "vwrap", frameW, frameH),
          `[vwrap]setsar=1,fps=${fps},format=yuv420p[vout]`
        ]
      : [
          `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB,` +
            `${containScale(frameW, frameH)},` +
            `pad=${frameW}:${frameH}:(ow-iw)/2:(oh-ih)/2:color=0x050914,setsar=1,fps=${fps},format=yuv420p[vout]`
        ];
    if (hasAudio) filters.push(`[0:a]aselect='${expr}',asetpts=N/SR/TB[aout]`);
    // The select expression carries one between() term per kept range, and a
    // long stream can have thousands of cuts — passed as an argv argument the
    // filtergraph would blow past the OS argument size limit (128 KB per arg
    // on Linux), so it goes through a filter script file instead.
    const filterPath = path.join(workDir, `export-${recordId}-body-filter.txt`);
    await writeFile(filterPath, `${filters.join(";\n")}\n`, "utf8");
    await runFfmpeg(
      [
        "-y",
        "-t",
        (lastEnd + 1).toFixed(3),
        "-i",
        srcPath,
        "-filter_complex_script",
        filterPath,
        "-map",
        "[vout]",
        ...(hasAudio ? ["-map", "[aout]"] : []),
        ...PART_ENC,
        ...(hasAudio ? AUDIO_ENC : ["-an"]),
        bodyPath
      ],
      { signal, onLine: (line) => {
          const seconds = parseProgressSeconds(line);
          if (seconds !== null) report(10, 76, seconds, bodySec);
        } }
    );
    parts.push(bodyPath);
  }
  await patchRecord(projectId, recordId, { progress: 87 });

  // 3. Join the parts losslessly (identical encode settings on both).
  let mergedPath: string;
  if (parts.length === 1) {
    mergedPath = parts[0];
  } else {
    mergedPath = path.join(workDir, `export-${recordId}-merged.mp4`);
    const listPath = path.join(workDir, `export-${recordId}-concat.txt`);
    const listDoc = parts.map((part) => `file '${part.replace(/'/g, "'\\''")}'`).join("\n");
    await writeFile(listPath, `${listDoc}\n`, "utf8");
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", mergedPath], { signal });
  }
  await patchRecord(projectId, recordId, { progress: 91 });

  // 3b. Burn-ins: the timeline overlay images and the whole-video captions, in
  // ONE pass over the joined edit. Both are authored in source seconds, so both
  // were mapped onto the concatenated hook + body timeline when the plan was
  // built. This is the export's single quality encode whenever it runs; the
  // parts feeding it were encoded near-lossless for exactly that reason.
  const videoPath = burnIn
    ? await runBurnIns(burnIn, mergedPath, path.join(workDir, `export-${recordId}-burned.mp4`), hasAudio, signal)
    : mergedPath;
  await patchRecord(projectId, recordId, { progress: 96 });

  // 4. Audio mix: every placed timeline audio clip is mixed under the edit
  // (each clip's source-timeline start mapped onto the edited runtime, its
  // library track looping to fill the clip length), the video's own audio
  // gets its own gain, and the whole mix gets a master gain. Video is
  // stream-copied so only the audio re-encodes.
  const fileName = `edited-${recordId}.mp4`;
  const finalPath = path.join(outDir, fileName);
  const editedSec = Math.max(0.1, hookSec + bodySec);
  const videoVol = project.music.videoVolume ?? 1;
  const masterVol = project.music.masterVolume ?? 1;
  const videoVolChanged = Math.abs(videoVol - 1) > 0.001;
  const masterVolChanged = Math.abs(masterVol - 1) > 0.001;
  const mixed = await mixAudioClips(project, videoPath, finalPath, editedSec, hasAudio, videoVol, masterVol, signal);
  if (!mixed) {
    if (hasAudio) {
      // No audio clips to mix, but the track still gets the video/master gain
      // and the broadcast-level pass. Video is stream-copied, so this is an
      // audio-only re-encode.
      const gain = videoVolChanged || masterVolChanged
        ? `volume=${videoVol.toFixed(3)},volume=${masterVol.toFixed(3)},`
        : "";
      await runFfmpeg([
        "-y",
        "-i",
        videoPath,
        "-filter_complex",
        `[0:a]${gain}${LOUDNORM}[aout]`,
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        ...AUDIO_ENC,
        "-movflags",
        "+faststart",
        finalPath
      ], { signal });
    } else {
      // Nothing to mix: remux with +faststart so the file streams instantly.
      await runFfmpeg(["-y", "-i", videoPath, "-c", "copy", "-movflags", "+faststart", finalPath], { signal });
    }
  }

  await patchRecord(projectId, recordId, { status: "done", progress: 100, file: fileName });
}

/** How much of a sound-effect file plays per hit — keeps stray long uploads in check. */
const SFX_MAX_SEC = 4;

/**
 * Resolves the project's auto sound-effect plan into concrete files and
 * edited-runtime offsets. Cues are planned over the full source transcript,
 * then each hit is mapped onto the edited runtime the same way placed audio
 * clips are (a hit inside cut footage snaps forward to the next jump cut).
 * Hits are grouped per sound so the mix opens each file once.
 */
async function resolveSfxOneShots(
  project: LongformProject,
  editedSec: number
): Promise<Array<{ path: string; offsetsSec: number[]; volume: number }>> {
  const sfx = project.sfx;
  if (!sfx?.enabled) return [];
  const cues = planSfxCues(project.transcript ?? [], sfx);
  if (cues.length === 0) return [];
  const volume = Math.min(2, Math.max(0, sfx.volume));
  const bySound = new Map<SfxSoundId, number[]>();
  for (const cue of cues) {
    const outStart = sourceTimeToOutput(cue.time, project.segments, project.hook);
    if (outStart === null || outStart >= editedSec - 0.05) continue;
    const offsets = bySound.get(cue.soundId) ?? [];
    offsets.push(Math.max(0, outStart));
    bySound.set(cue.soundId, offsets);
  }
  const oneShots: Array<{ path: string; offsetsSec: number[]; volume: number }> = [];
  for (const [soundId, offsetsSec] of bySound) {
    const soundPath = await resolveSoundPath(soundId);
    if (!soundPath) continue;
    oneShots.push({ path: soundPath, offsetsSec, volume });
  }
  return oneShots;
}

/**
 * Mixes the project's placed audio clips and auto sound effects under the
 * edited video and writes the final file. Each music clip's source-timeline
 * start is mapped onto the edited runtime and its library track loops to fill
 * the clip length; each sound effect plays once at its planned moment. When
 * the video has its own audio everything is mixed under it. Returns false
 * when there is nothing to mix, so the caller can fall back to a plain remux.
 */
async function mixAudioClips(
  project: LongformProject,
  videoPath: string,
  finalPath: string,
  editedSec: number,
  hasAudio: boolean,
  videoVol: number,
  masterVol: number,
  signal: AbortSignal
): Promise<boolean> {
  const clips = project.music.enabled ? project.music.clips ?? [] : [];
  const resolved: Array<{ path: string; offsetSec: number; duration: number; volume: number }> = [];
  for (const clip of clips) {
    if (!clip.trackId) continue;
    const track = await getTrack(clip.trackId);
    if (!track) continue;
    const trackPath = trackFilePath(track);
    if (!(await fileExists(trackPath))) continue;
    const outStart = sourceTimeToOutput(clip.start, project.segments, project.hook);
    if (outStart === null || outStart >= editedSec - 0.05) continue;
    const duration = Math.min(Math.max(0.1, clip.duration), editedSec - outStart);
    resolved.push({
      path: trackPath,
      offsetSec: Math.max(0, outStart),
      duration,
      volume: Math.min(1, Math.max(0, clip.volume))
    });
  }
  const oneShots = await resolveSfxOneShots(project, editedSec);
  if (resolved.length === 0 && oneShots.length === 0) return false;

  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  resolved.forEach((clip, index) => {
    const inputIndex = index + 1; // input 0 is the video
    inputs.push("-stream_loop", "-1", "-i", clip.path);
    const offMs = Math.round(clip.offsetSec * 1000);
    // A short tail fade keeps the loop's hard cut from clicking.
    const fade = clip.duration > 0.3 ? `,afade=t=out:st=${(clip.duration - 0.1).toFixed(2)}:d=0.1` : "";
    filters.push(
      `[${inputIndex}:a]atrim=0:${clip.duration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${clip.volume.toFixed(3)}${fade}` +
        (offMs > 0 ? `,adelay=${offMs}|${offMs}` : "") +
        `[c${index}]`
    );
    labels.push(`[c${index}]`);
  });

  // Sound effects: one input per distinct sound, split into one delayed copy
  // per hit so a sound that fires many times is only decoded once.
  let sfxInputIndex = resolved.length + 1;
  oneShots.forEach((shot, shotIndex) => {
    inputs.push("-i", shot.path);
    const base = `[${sfxInputIndex}:a]atrim=0:${SFX_MAX_SEC},asetpts=PTS-STARTPTS,volume=${shot.volume.toFixed(3)}`;
    if (shot.offsetsSec.length === 1) {
      const offMs = Math.round(shot.offsetsSec[0] * 1000);
      filters.push(`${base}${offMs > 0 ? `,adelay=${offMs}|${offMs}` : ""}[s${shotIndex}_0]`);
      labels.push(`[s${shotIndex}_0]`);
    } else {
      const splits = shot.offsetsSec.map((_, hit) => `[u${shotIndex}_${hit}]`).join("");
      filters.push(`${base},asplit=${shot.offsetsSec.length}${splits}`);
      shot.offsetsSec.forEach((offsetSec, hit) => {
        const offMs = Math.round(offsetSec * 1000);
        filters.push(`[u${shotIndex}_${hit}]${offMs > 0 ? `adelay=${offMs}|${offMs}` : "anull"}[s${shotIndex}_${hit}]`);
        labels.push(`[s${shotIndex}_${hit}]`);
      });
    }
    sfxInputIndex += 1;
  });

  const filter = hasAudio
    ? `${filters.join(";")};[0:a]volume=${videoVol.toFixed(3)}[v0];[v0]${labels.join("")}amix=inputs=${labels.length + 1}:duration=first:dropout_transition=0:normalize=0[mix];[mix]volume=${masterVol.toFixed(3)},${LOUDNORM}[aout]`
    : `${filters.join(";")};${labels.join("")}${labels.length > 1 ? `amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,` : ""}apad,atrim=0:${editedSec.toFixed(3)}[mix];[mix]volume=${masterVol.toFixed(3)},${LOUDNORM}[aout]`;

  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    ...AUDIO_ENC,
    ...(hasAudio ? ["-shortest"] : []),
    "-movflags",
    "+faststart",
    finalPath
  ], { signal });
  return true;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** One ffmpeg pass that draws everything burned over the finished edit. */
type BurnInPlan = { inputs: string[]; filters: string[] };

/**
 * Plans the overlay images and whole-video captions burned over the edited
 * runtime, as a single filtergraph.
 *
 * Both are authored in SOURCE seconds, so both are remapped onto the edited
 * timeline here (anything landing only inside cut footage drops out). When the
 * hook renders its own captions, the source window it covers is skipped so the
 * two never stack. Returns null when there is nothing to draw, which is what
 * lets the render skip a whole re-encode of the edit.
 */
async function planBurnIns(
  project: LongformProject,
  frame: ExportFrame,
  workDir: string,
  recordId: string
): Promise<BurnInPlan | null> {
  const drawable: Array<{ path: string; intervals: KeptRange[]; x: number; y: number; width: number; opacity: number }> = [];
  for (const overlay of project.overlays ?? []) {
    const intervals = sourceToOutputIntervals(overlay.start, overlay.end, project.segments, project.hook);
    if (intervals.length === 0) continue;
    const imagePath = overlayFilePath(project.id, overlay.storedName);
    if (!(await fileExists(imagePath))) continue;
    drawable.push({
      path: imagePath,
      intervals,
      x: Math.min(1, Math.max(0, overlay.x)),
      y: Math.min(1, Math.max(0, overlay.y)),
      width: Math.min(1, Math.max(0.02, overlay.width)),
      opacity: Math.min(1, Math.max(0, overlay.opacity))
    });
  }

  const assPath = await writeBodyCaptions(project, frame, workDir, recordId);
  if (drawable.length === 0 && !assPath) return null;

  const inputs = drawable.flatMap((item) => ["-i", item.path]);
  const filters: string[] = [];
  drawable.forEach((item, index) => {
    const scaledW = Math.max(2, Math.round(item.width * frame.frameW));
    // Scale to the requested width (keeping aspect), then apply opacity.
    filters.push(
      `[${index + 1}:v]${scaleFilter(scaledW, -1)},format=rgba,colorchannelmixer=aa=${item.opacity.toFixed(3)}[ov${index}]`
    );
  });
  let prev = "0:v";
  drawable.forEach((item, index) => {
    const enable = item.intervals
      .map((iv) => `between(t,${iv.start.toFixed(3)},${iv.end.toFixed(3)})`)
      .join("+");
    const label = index === drawable.length - 1 && !assPath ? "vout" : `b${index}`;
    filters.push(
      `[${prev}][ov${index}]overlay=x='(main_w*${item.x})-(overlay_w/2)':` +
        `y='(main_h*${item.y})-(overlay_h/2)':enable='${enable}'[${label}]`
    );
    prev = label;
  });
  if (assPath) filters.push(`[${prev}]ass='${escapeFilterPath(assPath)}'[vout]`);
  return { inputs, filters };
}

/**
 * Writes the whole-video caption script for the edited runtime and returns its
 * path, or null when captions are off or nothing survives the remap.
 */
async function writeBodyCaptions(
  project: LongformProject,
  frame: ExportFrame,
  workDir: string,
  recordId: string
): Promise<string | null> {
  const captions = project.captions;
  if (!captions?.enabled || captions.segments.length === 0) return null;
  const hookCaptionsBurned =
    project.hook.enabled && project.hook.captionsEnabled && project.hook.captions.some((c) => c.enabled && c.text.trim());
  const skipWindow = hookCaptionsBurned
    ? { start: Math.max(0, project.hook.start ?? 0), end: project.hook.end }
    : null;
  const remapped = remapCaptionsToOutput(captions.segments, project.segments, project.hook, skipWindow);
  if (remapped.length === 0) return null;

  const assDoc = buildAss(remapped, captions.style, frame.frameW, frame.frameH, captions.highlightCurrentWord);
  const assPath = path.join(workDir, `export-${recordId}-captions.ass`);
  await writeFile(assPath, `${assDoc}\n`, "utf8");
  return assPath;
}

/** Runs the planned burn-ins — the export's one quality encode when it exists. */
async function runBurnIns(
  plan: BurnInPlan,
  inputPath: string,
  outputPath: string,
  hasAudio: boolean,
  signal: AbortSignal
): Promise<string> {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    ...plan.inputs,
    "-filter_complex",
    plan.filters.join(";"),
    "-map",
    "[vout]",
    ...(hasAudio ? ["-map", "0:a?"] : []),
    ...VIDEO_ENC,
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    outputPath
  ], { signal });
  return outputPath;
}

/** Builds the ffmpeg select expression keeping only the given time ranges. */
export function selectExpression(ranges: KeptRange[]): string {
  return ranges.map((range) => `between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})`).join("+");
}
