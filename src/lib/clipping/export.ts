import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { shortsAudioArgs, shortsAudioFilter } from "@/lib/clipping/audio";
import { containScale, masterVideoArgs, scaleFilter } from "@/lib/clipping/encode";
import { buildAss, buildTextOverlayDialogue, buildWatermarkDialogue } from "@/lib/clipping/captions";
import { hasAudioStream, isRenderCanceled, probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { attachEditedClipRender, outputDir, workDir } from "@/lib/clipping/jobs";
import { renderSignature } from "@/lib/clipping/export-signature";
import {
  clipEditedDurationSec,
  keptClipRanges,
  remapClipCaptions,
  remapClipOverlays
} from "@/lib/clipping/segments";
import { LAYOUT_MODE_PRESETS } from "@/lib/clipping/layouts";
import { reframeChain, stackedLayoutChain } from "@/lib/clipping/render";
import { maybeAutoEnqueueExport } from "@/lib/publisher/enqueue";
import { planSfxCues } from "@/lib/sfx/cues";
import { resolveSoundPath } from "@/lib/sfx/sounds";
import type {
  CaptionSegment,
  CaptionStyle,
  ClipAudio,
  ClipCompositionMode,
  ClipEditSegment,
  ClipExportSettings,
  Overlay,
  RegionRect,
  SfxSettings,
  SfxSoundId
} from "@/types/domain";

export type ExportSpec = {
  jobId: string;
  sourceFile: string;
  baseDurationSec: number;
  trimStart: number;
  trimEnd: number;
  segments?: ClipEditSegment[];
  compositionMode: ClipCompositionMode;
  reframe: { scale: number; offsetX: number; offsetY: number };
  faceSource?: RegionRect;
  screenSource?: RegionRect;
  captions: CaptionSegment[];
  captionStyle: CaptionStyle;
  captionsVisible: boolean;
  highlightCurrentWord: boolean;
  overlays: Overlay[];
  audio: ClipAudio;
  /** Auto-placed viral sound effects, planned from the trimmed captions. */
  sfx?: SfxSettings;
  settings: ClipExportSettings;
};

export type ExportStatus = "processing" | "done" | "error" | "canceled";

export type ExportRecord = {
  id: string;
  jobId: string;
  status: ExportStatus;
  progress: number;
  file?: string;
  width: number;
  height: number;
  format: string;
  error?: string;
  createdAt: string;
};

type ExportsGlobal = typeof globalThis & {
  __clipExports?: Map<string, ExportRecord>;
  __clipExportControllers?: Map<string, AbortController>;
};
const g = globalThis as ExportsGlobal;
const exports = (g.__clipExports ??= new Map<string, ExportRecord>());
// Abort controllers for in-flight renders, so a render can be stopped safely
// (the ffmpeg process is killed) from the export route. Keyed by export id.
const controllers = (g.__clipExportControllers ??= new Map<string, AbortController>());

export function getExport(id: string): ExportRecord | undefined {
  return exports.get(id);
}

/**
 * Stops an in-flight render safely: aborts the ffmpeg process and marks the
 * record "canceled". A no-op (returns the record as-is) once the export has
 * already finished, errored, or been stopped.
 */
export function cancelExport(id: string): ExportRecord | undefined {
  const record = exports.get(id);
  if (!record) return undefined;
  if (record.status === "processing") {
    controllers.get(id)?.abort();
    controllers.delete(id);
    record.status = "canceled";
    record.progress = 0;
    record.error = undefined;
  }
  return record;
}

function crf(format: string, quality: ExportSpec["settings"]["quality"]): number {
  if (format === "webm") return quality === "high" ? 20 : quality === "medium" ? 28 : 34;
  return quality === "high" ? 16 : quality === "medium" ? 20 : 24;
}

function dataUrlToBuffer(src: string): Buffer | null {
  const m = src.match(/^data:[^;]+;base64,(.*)$/s);
  if (!m) return null;
  return Buffer.from(m[1], "base64");
}

function editRanges(spec: ExportSpec) {
  return keptClipRanges(
    spec.baseDurationSec,
    spec.trimStart,
    spec.trimEnd,
    spec.segments
  );
}

function trimDuration(spec: ExportSpec): number {
  return clipEditedDurationSec(
    spec.baseDurationSec,
    spec.trimStart,
    spec.trimEnd,
    spec.segments
  );
}

function shiftedCaptions(spec: ExportSpec): CaptionSegment[] {
  return remapClipCaptions(spec.captions, editRanges(spec));
}

function shiftedOverlays(spec: ExportSpec): Overlay[] {
  return remapClipOverlays(spec.overlays, editRanges(spec), spec.baseDurationSec);
}

function selectExpression(spec: ExportSpec): string {
  const ranges = editRanges(spec);
  if (ranges.length === 0) throw new Error("Nothing to export — every timeline segment is cut.");
  return ranges.map((range) => `between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})`).join("+");
}

async function writeOverlayImages(spec: ExportSpec, dir: string) {
  const images: { overlay: Overlay; file: string }[] = [];
  let i = 0;
  for (const overlay of shiftedOverlays(spec)) {
    if (overlay.kind === "text" && !overlay.src) continue;
    if (!overlay.src) continue;
    const buf = dataUrlToBuffer(overlay.src);
    if (!buf) continue;
    const file = path.join(dir, `ov-${i++}.png`);
    await writeFile(file, buf);
    images.push({ overlay, file });
  }
  return images;
}

/** Generates the combined ASS document (captions + positioned text overlays). */
function buildExportAss(spec: ExportSpec, w: number, h: number): string {
  const dur = trimDuration(spec);
  const captions = shiftedCaptions(spec);
  const overlays = shiftedOverlays(spec);
  const captionDoc = buildAss(
    spec.captionsVisible ? captions : [],
    spec.captionStyle,
    w,
    h,
    spec.highlightCurrentWord
  );
  const overlayLines = overlays
    .filter((o) => o.kind === "text" && o.text && o.text.trim())
    .map((o) =>
      buildTextOverlayDialogue(
        o.text as string,
        {
          x: o.x,
          y: o.y,
          start: o.start,
          end: o.end > o.start ? o.end : dur,
          fontScale: 0.05 * o.scale,
          color: o.color ?? "#bd93f9",
          rotation: o.rotation,
          bold: (o.fontWeight ?? 800) >= 600,
          opacity: o.opacity
        },
        w,
        h
      )
    );
  const extra = [...overlayLines];
  if (spec.settings.watermark) {
    extra.push(buildWatermarkDialogue(h, 0, dur));
  }
  return extra.length ? `${captionDoc}${extra.join("\n")}\n` : captionDoc;
}

/** Escapes a filesystem path for use inside an ffmpeg filtergraph argument. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function centerBlurChain(
  inLabel: string,
  outLabel: string,
  w: number,
  h: number,
  scale = 1,
  offsetX = 0,
  offsetY = 0
): string {
  const cropScale = Math.max(1, scale);
  const sx = Math.max(-1, Math.min(1, offsetX));
  const sy = Math.max(-1, Math.min(1, offsetY));
  const x = `(W-w)/2+${sx.toFixed(4)}*(W-w)/2`;
  const y = `(H-h)/2+${sy.toFixed(4)}*(H-h)/2`;
  return (
    `[${inLabel}]split=2[__bg][__fg];` +
    `[__bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:4,eq=brightness=-0.1[__bgb];` +
    `[__fg]${containScale(w, h)},${scaleFilter(`iw*${cropScale}`, `ih*${cropScale}`)},setsar=1[__fgs];` +
    `[__bgb][__fgs]overlay=x='${x}':y='${y}'[${outLabel}]`
  );
}

/** Letterboxes the full source frame into the output with no blur fill. */
function fitChain(inLabel: string, outLabel: string, w: number, h: number): string {
  return (
    `[${inLabel}]${containScale(w, h)},` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${outLabel}]`
  );
}

function sourceCompositionChain(spec: ExportSpec, w: number, h: number): string {
  const layoutPreset = LAYOUT_MODE_PRESETS[spec.compositionMode];
  if (layoutPreset && h > w) {
    return stackedLayoutChain(layoutPreset, undefined, w, h, spec.faceSource, spec.screenSource).replace(/\[vout\]$/, "[v0]");
  }
  if (spec.compositionMode === "fit") {
    return fitChain("0:v", "v0", w, h);
  }
  if (spec.compositionMode === "crop-fill") {
    return reframeChain("0:v", "v0", w, h, spec.reframe.scale, spec.reframe.offsetX, spec.reframe.offsetY);
  }
  return centerBlurChain("0:v", "v0", w, h, spec.reframe.scale, spec.reframe.offsetX, spec.reframe.offsetY);
}

async function buildArgs(spec: ExportSpec, dir: string): Promise<{ args: string[]; outFile: string }> {
  const { settings } = spec;
  const w = settings.width;
  const h = settings.height;
  const basePath = path.join(outputDir(spec.jobId), spec.sourceFile);
  const dur = trimDuration(spec);
  if (dur < 0.05) throw new Error("Nothing to export — every timeline segment is cut.");
  const selectExpr = selectExpression(spec);
  const hasAudio = await hasAudioStream(basePath).catch(() => false);

  const images = await writeOverlayImages(spec, dir);
  const assPath = path.join(dir, "subs.ass");
  await writeFile(assPath, buildExportAss(spec, w, h), "utf8");

  const ext = settings.format === "webm" ? "webm" : "mp4";
  const outFile = path.join(outputDir(spec.jobId), `export-${path.basename(dir)}.${ext}`);

  const inputs: string[] = ["-i", basePath];
  for (const img of images) inputs.push("-i", img.file);
  let musicIndex = -1;
  if (spec.audio.musicSrc) {
    const buf = dataUrlToBuffer(spec.audio.musicSrc);
    if (buf) {
      const musicFile = path.join(dir, "music.audio");
      await writeFile(musicFile, buf);
      musicIndex = 1 + images.length;
      inputs.push("-i", musicFile);
    }
  }

  // Auto sound effects: cues are planned over the trimmed captions (already
  // clip-relative), grouped per sound so each file is opened once, then split
  // into one delayed copy per hit inside the audio filtergraph below.
  const sfxShots: Array<{ index: number; offsetsSec: number[] }> = [];
  let sfxVolume = 1;
  if (spec.sfx?.enabled) {
    sfxVolume = Math.min(2, Math.max(0, spec.sfx.volume));
    const cues = planSfxCues(shiftedCaptions(spec), spec.sfx).filter((cue) => cue.time < dur - 0.05);
    const bySound = new Map<SfxSoundId, number[]>();
    for (const cue of cues) {
      const offsets = bySound.get(cue.soundId) ?? [];
      offsets.push(Math.max(0, cue.time));
      bySound.set(cue.soundId, offsets);
    }
    let nextInputIndex = 1 + images.length + (musicIndex >= 0 ? 1 : 0);
    for (const [soundId, offsetsSec] of bySound) {
      const soundPath = await resolveSoundPath(soundId);
      if (!soundPath) continue;
      sfxShots.push({ index: nextInputIndex, offsetsSec });
      inputs.push("-i", soundPath);
      nextInputIndex += 1;
    }
  }

  // --- Video filtergraph ---
  const parts: string[] = [];
  parts.push(sourceCompositionChain(spec, w, h));
  parts.push(`[v0]select='${selectExpr}',setpts=N/FRAME_RATE/TB[vcut]`);
  let last = "vcut";
  images.forEach((img, k) => {
    const inputIdx = 1 + k;
    const o = img.overlay;
    const rad = (o.rotation * Math.PI) / 180;
    const targetW = Math.max(16, Math.round(w * 0.4 * o.scale));
    const rotate = o.rotation
      ? `,rotate=${rad.toFixed(4)}:c=none:ow=rotw(${rad.toFixed(4)}):oh=roth(${rad.toFixed(4)})`
      : "";
    parts.push(
      `[${inputIdx}:v]format=rgba,colorchannelmixer=aa=${o.opacity.toFixed(3)},${scaleFilter(targetW, -1)}${rotate}[ov${k}]`
    );
    const enable = `:enable='between(t,${o.start},${o.end > o.start ? o.end : dur})'`;
    const next = `vov${k}`;
    parts.push(`[${last}][ov${k}]overlay=x=W*${o.x.toFixed(4)}-w/2:y=H*${o.y.toFixed(4)}-h/2${enable}[${next}]`);
    last = next;
  });
  parts.push(`[${last}]ass='${escapeFilterPath(assPath)}'[vout]`);

  // --- Audio filtergraph ---
  // Every audio source lands in `audioLabels` (clip audio, background music,
  // one delayed copy of a sound effect per hit), then a single amix folds
  // them together. A lone source skips the mix entirely.
  let audioMapped = false;
  const fadeOutStart = Math.max(0, dur - spec.audio.fadeOut);
  const audioLabels: string[] = [];
  if (hasAudio) {
    const af: string[] = [
      `aselect='${selectExpr}'`,
      "asetpts=N/SR/TB",
      `volume=${spec.audio.clipVolume.toFixed(3)}`
    ];
    if (spec.audio.fadeIn > 0) af.push(`afade=t=in:st=0:d=${spec.audio.fadeIn}`);
    if (spec.audio.fadeOut > 0) af.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${spec.audio.fadeOut}`);
    parts.push(`[0:a]${af.join(",")}[a0]`);
    audioLabels.push("[a0]");
  }
  if (musicIndex >= 0) {
    parts.push(
      `[${musicIndex}:a]volume=${spec.audio.musicVolume.toFixed(3)},atrim=0:${dur.toFixed(2)},asetpts=N/SR/TB[am]`
    );
    audioLabels.push("[am]");
  }
  sfxShots.forEach((shot, shotIndex) => {
    const base = `[${shot.index}:a]atrim=0:4,asetpts=PTS-STARTPTS,volume=${sfxVolume.toFixed(3)}`;
    if (shot.offsetsSec.length === 1) {
      const offMs = Math.round(shot.offsetsSec[0] * 1000);
      parts.push(`${base}${offMs > 0 ? `,adelay=${offMs}|${offMs}` : ""}[s${shotIndex}_0]`);
      audioLabels.push(`[s${shotIndex}_0]`);
    } else {
      const splits = shot.offsetsSec.map((_, hit) => `[u${shotIndex}_${hit}]`).join("");
      parts.push(`${base},asplit=${shot.offsetsSec.length}${splits}`);
      shot.offsetsSec.forEach((offsetSec, hit) => {
        const offMs = Math.round(offsetSec * 1000);
        parts.push(`[u${shotIndex}_${hit}]${offMs > 0 ? `adelay=${offMs}|${offMs}` : "anull"}[s${shotIndex}_${hit}]`);
        audioLabels.push(`[s${shotIndex}_${hit}]`);
      });
    }
  });
  // The finished mix is mastered to the short-form loudness target on its way
  // out — the same treatment the long-form render has always given its final
  // mix, and the reason an exported clip sits at the same volume as everything
  // around it in a feed. Applied AFTER the mix so the creator's clip/music/sfx
  // balance is what gets normalized, never each source separately.
  const master = (label: string) => `[${label}]${shortsAudioFilter()}[aout]`;
  if (audioLabels.length === 1) {
    parts.push(master(audioLabels[0].slice(1, -1)));
    audioMapped = true;
  } else if (audioLabels.length > 1) {
    // duration=first keeps the clip's own audio in charge of length; without
    // clip audio the mix is padded then cut to the trimmed duration instead.
    const tail = hasAudio
      ? `amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0,${shortsAudioFilter()}[aout]`
      : `amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=0:${dur.toFixed(2)},${shortsAudioFilter()}[aout]`;
    parts.push(`${audioLabels.join("")}${tail}`);
    audioMapped = true;
  }

  const args = ["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[vout]"];
  if (audioMapped) args.push("-map", "[aout]");
  args.push("-r", String(settings.fps), "-t", dur.toFixed(2));

  if (settings.format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf("webm", settings.quality)));
    if (audioMapped) args.push("-c:a", "libopus", "-b:a", "192k");
    else args.push("-an");
  } else {
    args.push(...masterVideoArgs(crf("mp4", settings.quality)));
    if (audioMapped) args.push(...shortsAudioArgs());
    else args.push("-an");
    args.push("-movflags", "+faststart");
  }
  args.push(outFile);
  return { args, outFile };
}

export function startExport(spec: ExportSpec): ExportRecord {
  const id = crypto.randomUUID().slice(0, 8);
  const record: ExportRecord = {
    id,
    jobId: spec.jobId,
    status: "processing",
    progress: 1,
    width: spec.settings.width,
    height: spec.settings.height,
    format: spec.settings.format,
    createdAt: new Date().toISOString()
  };
  exports.set(id, record);
  const controller = new AbortController();
  controllers.set(id, controller);
  void runExport(record, spec, controller.signal)
    .catch((error) => {
      // A deliberate stop lands here as a RenderCanceledError — don't dress it
      // up as a failure. cancelExport already flipped the record to "canceled".
      if (isRenderCanceled(error) || controller.signal.aborted) {
        record.status = "canceled";
        record.error = undefined;
        return;
      }
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => controllers.delete(id));
  return record;
}

async function runExport(record: ExportRecord, spec: ExportSpec, signal: AbortSignal) {
  const dir = path.join(workDir(spec.jobId), `export-${record.id}`);
  await mkdir(dir, { recursive: true });
  const { args, outFile } = await buildArgs(spec, dir);
  const total = Math.max(0.1, trimDuration(spec));

  try {
    await runFfmpeg(args, {
      signal,
      onLine: (line) => {
        if (signal.aborted) return;
        const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          record.progress = Math.min(99, Math.max(1, Math.round((t / total) * 100)));
        }
      }
    });
  } catch (error) {
    // On a stop, remove the half-written output so nothing downstream ever
    // picks up a truncated, unplayable file.
    if (isRenderCanceled(error) || signal.aborted) {
      await rm(outFile, { force: true }).catch(() => undefined);
    }
    throw error;
  }

  // Never mark complete unless a real, probeable, non-empty file exists.
  const info = await stat(outFile).catch(() => null);
  if (!info || info.size < 1024) {
    throw new Error("Export finished but produced no usable video file.");
  }
  await probeDuration(outFile); // throws if the output is not a valid video
  record.file = path.basename(outFile);

  // Record the export on the clip it was cut from — with the signature of the
  // edits it was rendered from — so the Clip Generator and the Uploading Center
  // pick up the edited clip instead of the auto render, and can tell when a
  // later trim/edit has made this render stale. This must land BEFORE the
  // record flips to "done": the editor navigates to the Uploading Center the
  // instant it sees "done", and that page reads the clip's edited file — so if
  // the attach ran afterward it could schedule the un-trimmed render.
  await attachEditedClipRender(
    spec.jobId,
    spec.sourceFile,
    record.file,
    renderSignature({
      baseDurationSec: spec.baseDurationSec,
      trimStart: spec.trimStart,
      trimEnd: spec.trimEnd,
      segments: spec.segments,
      compositionMode: spec.compositionMode,
      reframe: spec.reframe,
      faceSource: spec.faceSource,
      screenSource: spec.screenSource,
      captions: spec.captions,
      captionStyle: spec.captionStyle,
      captionsVisible: spec.captionsVisible,
      highlightCurrentWord: spec.highlightCurrentWord,
      overlays: spec.overlays,
      audio: spec.audio,
      sfx: spec.sfx,
      settings: spec.settings
    })
  ).catch(() => undefined);

  record.progress = 100;
  record.status = "done";

  // Opt-in scheduled publishing: when PUBLISH_ENABLED and PUBLISH_AUTO_ENQUEUE
  // are set, the finished export joins the publish queue (YouTube Shorts /
  // Instagram Reels / TikTok). No-op otherwise, and never fails the export.
  void maybeAutoEnqueueExport({
    jobId: spec.jobId,
    exportPath: outFile,
    spokenText: spec.captions.map((caption) => caption.text).join(" ")
  });
}
