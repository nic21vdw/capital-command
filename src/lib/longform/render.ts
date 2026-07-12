import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAss } from "@/lib/clipping/captions";
import { isRenderCanceled, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { animatedReframeChain } from "@/lib/clipping/render";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { getTrack, trackFilePath } from "@/lib/longform/music";
import { overlayFilePath } from "@/lib/longform/overlays";
import { editedDurationSec, exportRanges, remapCaptionsToOutput, sourceTimeToOutput, sourceToOutputIntervals, type KeptRange } from "@/lib/longform/plan";
import { getProject, projectOutputDir, projectWorkDir, updateProject } from "@/lib/longform/store";
import type { LongformExportRecord, LongformProject } from "@/lib/longform/types";
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
//      Timeline image overlays and the whole-video captions are then burned
//      over the joined edit (captions remapped through the cuts).
//   4. Audio — every placed timeline audio clip mixed under the edit.
// Export records persist on the project, so status survives a dev restart.

const FRAME_W = 1920;
const FRAME_H = 1080;
// The 9:16 vertical layout's output frame.
const VERT_W = 1080;
const VERT_H = 1920;
const FPS = 30;
// How long the hook's punch-in zoom takes to ramp from 1x to the target zoom.
const HOOK_ZOOM_RAMP_SEC = 0.5;

// Both parts encode with identical codec/size/fps/audio settings so the
// concat demuxer can join them with a pure stream copy.
//
// `superfast` (vs `veryfast`) roughly halves the encode time. In CRF mode the
// preset trades encoder effort for file size at (near) constant visual quality
// — so the exported clip looks the same, it just gets a little larger. That's a
// good deal for the body pass, which re-encodes the whole kept timeline and
// dominates export time. (The real cure for slow exports is not re-encoding the
// body at all — see the module header — but this keeps cuts frame-accurate.)
const VIDEO_ENC = ["-c:v", "libx264", "-preset", "superfast", "-crf", "20"];
const AUDIO_ENC = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];

/** Escapes a filesystem path for use inside an ffmpeg filtergraph argument. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** The export's output frame, decided by the project's layout. */
function frameSize(project: LongformProject): { frameW: number; frameH: number; vertical: boolean } {
  const vertical = (project.layout ?? "wide") === "vertical";
  return vertical ? { frameW: VERT_W, frameH: VERT_H, vertical } : { frameW: FRAME_W, frameH: FRAME_H, vertical };
}

/**
 * Wraps a stage's output into the 9:16 vertical frame: the picture scaled to
 * full width and centered over a blurred, dimmed cover fill of itself, so
 * nothing is cropped away — the same composition the Clip Generator's
 * vertical renders use. The background is blurred at quarter size (cheaper,
 * visually equivalent) and scaled back up.
 */
function verticalWrapChain(inLabel: string, outLabel: string): string {
  return (
    `[${inLabel}]split=2[__vwbg][__vwfg];` +
    `[__vwbg]scale=${VERT_W / 2}:${VERT_H / 2}:force_original_aspect_ratio=increase,crop=${VERT_W / 2}:${VERT_H / 2},` +
    `boxblur=12:2,eq=brightness=-0.08,scale=${VERT_W}:${VERT_H}[__vwbgb];` +
    `[__vwfg]scale=${VERT_W}:-2[__vwfgs];` +
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
 * Starts rendering the edited video and returns the (processing) export
 * record immediately; the client polls the export route for progress.
 */
export async function startLongformExport(project: LongformProject): Promise<LongformExportRecord> {
  if (project.status !== "ready") throw new Error("This project is still processing.");
  if (project.exports.some((record) => record.status === "processing")) {
    throw new Error("An export is already rendering for this project.");
  }
  const { hookRange, bodyRanges } = exportRanges(project.segments, project.hook);
  if (!hookRange && bodyRanges.length === 0) {
    throw new Error("Nothing to export — every segment is cut. Re-enable at least one segment.");
  }

  const recordId = crypto.randomUUID().slice(0, 8);

  // Shared post-processing step (same one the short-form pipeline uses): run
  // the project name through the emoji decorator and log the title for CTR
  // analysis. The project name is the best available content signal, so the
  // decorator keyword-matches it onto a category; with emoji disabled the
  // title is returned unchanged.
  const finalized = await finalizeTitle({
    baseTitle: project.name,
    category: project.name,
    pipelineType: "long",
    videoId: recordId
  });

  const record: LongformExportRecord = {
    id: recordId,
    status: "processing",
    progress: 1,
    durationSec: editedDurationSec(project.segments, project.hook),
    title: finalized.title,
    emojiUsed: finalized.emojiUsed,
    createdAt: new Date().toISOString()
  };
  // Keep the record list short; old files stay on disk until project delete.
  const exports = [record, ...project.exports].slice(0, 6);
  await updateProject(project.id, { exports });

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
  const project = await getProject(projectId);
  if (!project) throw new Error("Project is gone.");
  const meta = await readSourceMeta(project.sourceId);
  if (!meta) throw new Error("The uploaded source file for this project is gone. Upload the video again.");
  const srcPath = sourceFilePath(meta);
  const workDir = projectWorkDir(projectId);
  const outDir = projectOutputDir(projectId);
  const { hookRange, bodyRanges } = exportRanges(project.segments, project.hook);
  const hasAudio = project.hasAudio;
  const { frameW, frameH, vertical } = frameSize(project);

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
    const captions = project.hook.captionsEnabled ? project.hook.captions.filter((c) => c.enabled && c.text.trim()) : [];
    if (captions.length > 0) {
      const assDoc = buildAss(captions, project.hook.captionStyle, frameW, frameH, project.hook.highlightCurrentWord);
      const assPath = path.join(workDir, `export-${recordId}-hook.ass`);
      await writeFile(assPath, `${assDoc}\n`, "utf8");
      assArg = `ass='${escapeFilterPath(assPath)}',`;
    }
    // animatedReframeChain crops a zoomed cover of the frame around the focus
    // point, with a blurred fill behind so the punch-in never shows black
    // edges. The zoom ramps in from 1x over the first HOOK_ZOOM_RAMP_SEC
    // seconds (ease-out) so the opening glides into the punch-in instead of
    // snapping to full zoom on the very first frame. The ramp is capped at
    // half the hook so short hooks still finish the move before they end.
    // On the vertical layout the punch-in still runs on the 16:9 frame, which
    // is then wrapped into the 9:16 frame; the captions burn over the full
    // vertical frame afterwards.
    const sx = project.hook.focusX * 2 - 1;
    const sy = project.hook.focusY * 2 - 1;
    const rampSec = Math.min(HOOK_ZOOM_RAMP_SEC, Math.max(0.05, hookSec / 2));
    const reframe = animatedReframeChain("0:v", "vz", FRAME_W, FRAME_H, project.hook.zoom, sx, sy, rampSec, FPS);
    const filter = vertical
      ? `${reframe};${verticalWrapChain("vz", "vv")};[vv]${assArg}fps=${FPS},setsar=1,format=yuv420p[vout]`
      : `${reframe};[vz]${assArg}fps=${FPS},setsar=1,format=yuv420p[vout]`;
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
        ...VIDEO_ENC,
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
          verticalWrapChain("vsel", "vwrap"),
          `[vwrap]setsar=1,fps=${FPS},format=yuv420p[vout]`
        ]
      : [
          `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB,` +
            `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=decrease,` +
            `pad=${FRAME_W}:${FRAME_H}:(ow-iw)/2:(oh-ih)/2:color=0x050914,setsar=1,fps=${FPS},format=yuv420p[vout]`
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
        ...VIDEO_ENC,
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

  // 3b. Timeline overlays: burn each dropped-in image over the edited runtime.
  // Images are authored in source seconds, so their visible window is mapped
  // onto the concatenated hook + body timeline before it is drawn.
  const overlaidPath = await applyOverlays(project, mergedPath, workDir, recordId, hasAudio, signal);
  await patchRecord(projectId, recordId, { progress: 94 });

  // 3c. Whole-video captions: burn the transcript captions over the edited
  // runtime, on top of any image overlays. Segments are authored in source
  // seconds, so each one shifts back by the cuts before it; when the hook
  // burns its own captions these take over from hook.end onward.
  const videoPath = await applyBodyCaptions(project, overlaidPath, workDir, recordId, hasAudio, signal);
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
    if (hasAudio && (videoVolChanged || masterVolChanged)) {
      // No audio clips, but the video/master gain differs from unity —
      // re-encode just the audio with the combined gain applied. Video is
      // stream-copied.
      await runFfmpeg([
        "-y",
        "-i",
        videoPath,
        "-filter_complex",
        `[0:a]volume=${videoVol.toFixed(3)},volume=${masterVol.toFixed(3)}[aout]`,
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
    ? `${filters.join(";")};[0:a]volume=${videoVol.toFixed(3)}[v0];[v0]${labels.join("")}amix=inputs=${labels.length + 1}:duration=first:dropout_transition=0:normalize=0[mix];[mix]volume=${masterVol.toFixed(3)}[aout]`
    : `${filters.join(";")};${labels.join("")}${labels.length > 1 ? `amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,` : ""}apad,atrim=0:${editedSec.toFixed(3)}[mix];[mix]volume=${masterVol.toFixed(3)}[aout]`;

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

/**
 * Draws the project's timeline overlay images onto the merged video and
 * returns the path to draw from next. When there is nothing to draw (no
 * overlays, missing files, or every overlay lands only inside cut footage)
 * the merged path is returned untouched so the video is never re-encoded for
 * no reason.
 */
async function applyOverlays(
  project: LongformProject,
  mergedPath: string,
  workDir: string,
  recordId: string,
  hasAudio: boolean,
  signal: AbortSignal
): Promise<string> {
  const overlays = project.overlays ?? [];
  if (overlays.length === 0) return mergedPath;

  const drawable: Array<{ path: string; intervals: KeptRange[]; x: number; y: number; width: number; opacity: number }> = [];
  for (const overlay of overlays) {
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
  if (drawable.length === 0) return mergedPath;

  const inputs = drawable.flatMap((item) => ["-i", item.path]);
  const filters: string[] = [];
  const { frameW } = frameSize(project);
  drawable.forEach((item, index) => {
    const scaledW = Math.max(2, Math.round(item.width * frameW));
    // Scale to the requested width (keeping aspect), then apply opacity.
    filters.push(
      `[${index + 1}:v]scale=${scaledW}:-1,format=rgba,colorchannelmixer=aa=${item.opacity.toFixed(3)}[ov${index}]`
    );
  });
  let prev = "0:v";
  drawable.forEach((item, index) => {
    const enable = item.intervals
      .map((iv) => `between(t,${iv.start.toFixed(3)},${iv.end.toFixed(3)})`)
      .join("+");
    const label = index === drawable.length - 1 ? "vout" : `b${index}`;
    filters.push(
      `[${prev}][ov${index}]overlay=x='(main_w*${item.x})-(overlay_w/2)':` +
        `y='(main_h*${item.y})-(overlay_h/2)':enable='${enable}'[${label}]`
    );
    prev = label;
  });

  const overlaidPath = path.join(workDir, `export-${recordId}-overlaid.mp4`);
  await runFfmpeg([
    "-y",
    "-i",
    mergedPath,
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    ...(hasAudio ? ["-map", "0:a?"] : []),
    ...VIDEO_ENC,
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    overlaidPath
  ], { signal });
  return overlaidPath;
}

/**
 * Burns the whole-video captions onto the merged edit and returns the path to
 * draw from next. Caption segments live in source seconds, so they are first
 * remapped onto the edited runtime (dropping anything inside cut footage).
 * When the hook renders its own captions, the source window it covers is
 * skipped so the two never stack. Returns the input path untouched when
 * captions are off or nothing survives the remap.
 */
async function applyBodyCaptions(
  project: LongformProject,
  mergedPath: string,
  workDir: string,
  recordId: string,
  hasAudio: boolean,
  signal: AbortSignal
): Promise<string> {
  const captions = project.captions;
  if (!captions?.enabled || captions.segments.length === 0) return mergedPath;
  const hookCaptionsBurned =
    project.hook.enabled && project.hook.captionsEnabled && project.hook.captions.some((c) => c.enabled && c.text.trim());
  const skipWindow = hookCaptionsBurned
    ? { start: Math.max(0, project.hook.start ?? 0), end: project.hook.end }
    : null;
  const remapped = remapCaptionsToOutput(captions.segments, project.segments, project.hook, skipWindow);
  if (remapped.length === 0) return mergedPath;

  const { frameW, frameH } = frameSize(project);
  const assDoc = buildAss(remapped, captions.style, frameW, frameH, captions.highlightCurrentWord);
  const assPath = path.join(workDir, `export-${recordId}-captions.ass`);
  await writeFile(assPath, `${assDoc}\n`, "utf8");

  const captionedPath = path.join(workDir, `export-${recordId}-captioned.mp4`);
  await runFfmpeg([
    "-y",
    "-i",
    mergedPath,
    "-filter_complex",
    `[0:v]ass='${escapeFilterPath(assPath)}'[vout]`,
    "-map",
    "[vout]",
    ...(hasAudio ? ["-map", "0:a?"] : []),
    ...VIDEO_ENC,
    ...(hasAudio ? ["-c:a", "copy"] : ["-an"]),
    captionedPath
  ], { signal });
  return captionedPath;
}

/** Builds the ffmpeg select expression keeping only the given time ranges. */
export function selectExpression(ranges: KeptRange[]): string {
  return ranges.map((range) => `between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})`).join("+");
}
