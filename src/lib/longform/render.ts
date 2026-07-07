import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAss } from "@/lib/clipping/captions";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { reframeChain } from "@/lib/clipping/render";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";
import { getTrack, trackFilePath } from "@/lib/longform/music";
import { overlayFilePath } from "@/lib/longform/overlays";
import { editedDurationSec, exportRanges, sourceToOutputIntervals, type KeptRange } from "@/lib/longform/plan";
import { getProject, projectOutputDir, projectWorkDir, updateProject } from "@/lib/longform/store";
import type { LongformExportRecord, LongformProject } from "@/lib/longform/types";
import { finalizeTitle } from "@/lib/title/finalize";

// The Long-Form Editor's export engine. The edited video is baked in stages:
//   1. Hook — the opening seconds re-rendered with the punch-in zoom and the
//      big word-synced captions burned in.
//   2. Body — one single-pass select render that keeps only the enabled
//      segments, cutting every stretch of dead space in one ffmpeg run.
//   3. Concat — hook + body joined losslessly (identical encode settings).
//   4. Music — the chosen library track looped under the whole edit.
// Export records persist on the project, so status survives a dev restart.

const FRAME_W = 1920;
const FRAME_H = 1080;
const FPS = 30;

// Both parts encode with identical codec/size/fps/audio settings so the
// concat demuxer can join them with a pure stream copy.
const VIDEO_ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
const AUDIO_ENC = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];

/** Escapes a filesystem path for use inside an ffmpeg filtergraph argument. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Parses the `time=HH:MM:SS.cc` readout from an ffmpeg progress line. */
function parseProgressSeconds(line: string): number | null {
  const match = line.match(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function patchRecord(projectId: string, recordId: string, patch: Partial<LongformExportRecord>) {
  const project = await getProject(projectId);
  if (!project) return;
  const record = project.exports.find((item) => item.id === recordId);
  if (!record) return;
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

  void runExport(project.id, record.id).catch(async (error) => {
    await patchRecord(project.id, record.id, {
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  });
  return record;
}

async function runExport(projectId: string, recordId: string) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project is gone.");
  const meta = await readSourceMeta(project.sourceId);
  if (!meta) throw new Error("The uploaded source file for this project is gone. Upload the video again.");
  const srcPath = sourceFilePath(meta);
  const workDir = projectWorkDir(projectId);
  const outDir = projectOutputDir(projectId);
  const { hookRange, bodyRanges } = exportRanges(project.segments, project.hook);
  const hasAudio = project.hasAudio;

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
      const assDoc = buildAss(captions, project.hook.captionStyle, FRAME_W, FRAME_H, project.hook.highlightCurrentWord);
      const assPath = path.join(workDir, `export-${recordId}-hook.ass`);
      await writeFile(assPath, `${assDoc}\n`, "utf8");
      assArg = `ass='${escapeFilterPath(assPath)}',`;
    }
    // reframeChain crops a zoomed cover of the frame around the focus point,
    // with a blurred fill behind so the punch-in never shows black edges.
    const sx = project.hook.focusX * 2 - 1;
    const sy = project.hook.focusY * 2 - 1;
    const filter =
      reframeChain("0:v", "vz", FRAME_W, FRAME_H, project.hook.zoom, sx, sy) +
      `;[vz]${assArg}fps=${FPS},setsar=1,format=yuv420p[vout]`;
    await runFfmpeg(
      [
        "-y",
        "-i",
        srcPath,
        "-t",
        hookRange.end.toFixed(3),
        "-filter_complex",
        filter,
        "-map",
        "[vout]",
        ...(hasAudio ? ["-map", "0:a?"] : []),
        ...VIDEO_ENC,
        ...(hasAudio ? AUDIO_ENC : ["-an"]),
        hookPath
      ],
      { onLine: (line) => {
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
    const filters = [
      `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB,` +
        `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=decrease,` +
        `pad=${FRAME_W}:${FRAME_H}:(ow-iw)/2:(oh-ih)/2:color=0x050914,setsar=1,fps=${FPS},format=yuv420p[vout]`
    ];
    if (hasAudio) filters.push(`[0:a]aselect='${expr}',asetpts=N/SR/TB[aout]`);
    await runFfmpeg(
      [
        "-y",
        "-t",
        (lastEnd + 1).toFixed(3),
        "-i",
        srcPath,
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[vout]",
        ...(hasAudio ? ["-map", "[aout]"] : []),
        ...VIDEO_ENC,
        ...(hasAudio ? AUDIO_ENC : ["-an"]),
        bodyPath
      ],
      { onLine: (line) => {
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
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", mergedPath]);
  }
  await patchRecord(projectId, recordId, { progress: 91 });

  // 3b. Timeline overlays: burn each dropped-in image over the edited runtime.
  // Images are authored in source seconds, so their visible window is mapped
  // onto the concatenated hook + body timeline before it is drawn.
  const videoPath = await applyOverlays(project, mergedPath, workDir, recordId, hasAudio);
  await patchRecord(projectId, recordId, { progress: 94 });

  // 4. Background music: loop the library track under the edit, faded out at
  // the end. Video is stream-copied — only the audio re-encodes.
  const fileName = `edited-${recordId}.mp4`;
  const finalPath = path.join(outDir, fileName);
  const track = project.music.enabled && project.music.trackId ? await getTrack(project.music.trackId) : null;
  if (track) {
    const musicPath = trackFilePath(track);
    const editedSec = Math.max(0.1, hookSec + bodySec);
    const fade = Math.min(project.music.fadeOut, editedSec / 2);
    const musicChain =
      `[1:a]volume=${project.music.volume.toFixed(3)}` +
      (fade > 0.01 ? `,afade=t=out:st=${Math.max(0, editedSec - fade).toFixed(2)}:d=${fade.toFixed(2)}` : "") +
      `,atrim=0:${editedSec.toFixed(2)}[m]`;
    const filter = hasAudio
      ? `${musicChain};[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`
      : `${musicChain};[m]anull[aout]`;
    await runFfmpeg([
      "-y",
      "-i",
      videoPath,
      "-stream_loop",
      "-1",
      "-i",
      musicPath,
      "-filter_complex",
      filter,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      ...AUDIO_ENC,
      "-shortest",
      "-movflags",
      "+faststart",
      finalPath
    ]);
  } else {
    // No music: remux with +faststart so the file streams instantly.
    await runFfmpeg(["-y", "-i", videoPath, "-c", "copy", "-movflags", "+faststart", finalPath]);
  }

  await patchRecord(projectId, recordId, { status: "done", progress: 100, file: fileName });
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
  hasAudio: boolean
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
  drawable.forEach((item, index) => {
    const scaledW = Math.max(2, Math.round(item.width * FRAME_W));
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
  ]);
  return overlaidPath;
}

/** Builds the ffmpeg select expression keeping only the given time ranges. */
export function selectExpression(ranges: KeptRange[]): string {
  return ranges.map((range) => `between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})`).join("+");
}
