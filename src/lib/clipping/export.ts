import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAss, buildTextOverlayDialogue, buildWatermarkDialogue } from "@/lib/clipping/captions";
import { hasAudioStream, probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { outputDir, workDir } from "@/lib/clipping/jobs";
import { LAYOUT_MODE_PRESETS } from "@/lib/clipping/layouts";
import { reframeChain, stackedLayoutChain } from "@/lib/clipping/render";
import { maybeAutoEnqueueExport } from "@/lib/publisher/enqueue";
import type {
  CaptionSegment,
  CaptionStyle,
  ClipAudio,
  ClipCompositionMode,
  ClipExportSettings,
  Overlay,
  RegionRect
} from "@/types/domain";

export type ExportSpec = {
  jobId: string;
  sourceFile: string;
  baseDurationSec: number;
  trimStart: number;
  trimEnd: number;
  compositionMode: ClipCompositionMode;
  reframe: { scale: number; offsetX: number; offsetY: number };
  faceSource?: RegionRect;
  captions: CaptionSegment[];
  captionStyle: CaptionStyle;
  captionsVisible: boolean;
  highlightCurrentWord: boolean;
  overlays: Overlay[];
  audio: ClipAudio;
  settings: ClipExportSettings;
};

export type ExportStatus = "processing" | "done" | "error";

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

type ExportsGlobal = typeof globalThis & { __clipExports?: Map<string, ExportRecord> };
const g = globalThis as ExportsGlobal;
const exports = (g.__clipExports ??= new Map<string, ExportRecord>());

export function getExport(id: string): ExportRecord | undefined {
  return exports.get(id);
}

function crf(format: string, quality: ExportSpec["settings"]["quality"]): number {
  if (format === "webm") return quality === "high" ? 24 : quality === "medium" ? 31 : 37;
  return quality === "high" ? 18 : quality === "medium" ? 23 : 28;
}

function dataUrlToBuffer(src: string): Buffer | null {
  const m = src.match(/^data:[^;]+;base64,(.*)$/s);
  if (!m) return null;
  return Buffer.from(m[1], "base64");
}

function trimStartSec(spec: ExportSpec): number {
  return Math.max(0, Math.min(spec.trimStart || 0, spec.baseDurationSec));
}

function trimDuration(spec: ExportSpec): number {
  const start = trimStartSec(spec);
  const end = Math.max(start + 0.1, Math.min(spec.trimEnd || spec.baseDurationSec, spec.baseDurationSec));
  return end - start;
}

function shiftedCaptions(spec: ExportSpec): CaptionSegment[] {
  const start = trimStartSec(spec);
  const end = start + trimDuration(spec);
  return spec.captions
    .filter((caption) => caption.end > start && caption.start < end)
    .map((caption) => ({
      ...caption,
      start: Math.max(0, caption.start - start),
      end: Math.min(end, caption.end) - start,
      words: caption.words
        .filter((word) => word.end > start && word.start < end)
        .map((word) => ({
          ...word,
          start: Math.max(0, word.start - start),
          end: Math.min(end, word.end) - start
        }))
    }));
}

function shiftedOverlays(spec: ExportSpec): Overlay[] {
  const start = trimStartSec(spec);
  const end = start + trimDuration(spec);
  return spec.overlays
    .filter((overlay) => {
      const overlayEnd = overlay.end > overlay.start ? overlay.end : spec.baseDurationSec;
      return overlayEnd > start && overlay.start < end;
    })
    .map((overlay) => ({
      ...overlay,
      start: Math.max(0, overlay.start - start),
      end: Math.min(end, overlay.end > overlay.start ? overlay.end : spec.baseDurationSec) - start
    }));
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
          color: o.color ?? "#ffffff",
          rotation: o.rotation,
          bold: (o.fontWeight ?? 700) >= 600,
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
    `[__fg]scale=${w}:${h}:force_original_aspect_ratio=decrease,scale=iw*${cropScale}:ih*${cropScale},setsar=1[__fgs];` +
    `[__bgb][__fgs]overlay=x='${x}':y='${y}'[${outLabel}]`
  );
}

/** Letterboxes the full source frame into the output with no blur fill. */
function fitChain(inLabel: string, outLabel: string, w: number, h: number): string {
  return (
    `[${inLabel}]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${outLabel}]`
  );
}

function sourceCompositionChain(spec: ExportSpec, w: number, h: number): string {
  const layoutPreset = LAYOUT_MODE_PRESETS[spec.compositionMode];
  if (layoutPreset && h > w) {
    return stackedLayoutChain(layoutPreset, undefined, w, h, spec.faceSource).replace(/\[vout\]$/, "[v0]");
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
  const start = trimStartSec(spec);
  const dur = trimDuration(spec);
  const hasAudio = await hasAudioStream(basePath).catch(() => false);

  const images = await writeOverlayImages(spec, dir);
  const assPath = path.join(dir, "subs.ass");
  await writeFile(assPath, buildExportAss(spec, w, h), "utf8");

  const ext = settings.format === "webm" ? "webm" : "mp4";
  const outFile = path.join(outputDir(spec.jobId), `export-${path.basename(dir)}.${ext}`);

  const inputs: string[] = ["-ss", start.toFixed(2), "-i", basePath];
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

  // --- Video filtergraph ---
  const parts: string[] = [];
  parts.push(sourceCompositionChain(spec, w, h));
  let last = "v0";
  images.forEach((img, k) => {
    const inputIdx = 1 + k;
    const o = img.overlay;
    const rad = (o.rotation * Math.PI) / 180;
    const targetW = Math.max(16, Math.round(w * 0.4 * o.scale));
    const rotate = o.rotation
      ? `,rotate=${rad.toFixed(4)}:c=none:ow=rotw(${rad.toFixed(4)}):oh=roth(${rad.toFixed(4)})`
      : "";
    parts.push(
      `[${inputIdx}:v]format=rgba,colorchannelmixer=aa=${o.opacity.toFixed(3)},scale=${targetW}:-1${rotate}[ov${k}]`
    );
    const enable = `:enable='between(t,${o.start},${o.end > o.start ? o.end : dur})'`;
    const next = `vov${k}`;
    parts.push(`[${last}][ov${k}]overlay=x=W*${o.x.toFixed(4)}-w/2:y=H*${o.y.toFixed(4)}-h/2${enable}[${next}]`);
    last = next;
  });
  parts.push(`[${last}]ass='${escapeFilterPath(assPath)}'[vout]`);

  // --- Audio filtergraph ---
  let audioMapped = false;
  const fadeOutStart = Math.max(0, dur - spec.audio.fadeOut);
  if (hasAudio) {
    const af: string[] = [`volume=${spec.audio.clipVolume.toFixed(3)}`];
    if (spec.audio.fadeIn > 0) af.push(`afade=t=in:st=0:d=${spec.audio.fadeIn}`);
    if (spec.audio.fadeOut > 0) af.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${spec.audio.fadeOut}`);
    parts.push(`[0:a]${af.join(",")}[a0]`);
  }
  if (musicIndex >= 0) {
    parts.push(
      `[${musicIndex}:a]volume=${spec.audio.musicVolume.toFixed(3)},atrim=0:${dur.toFixed(2)},asetpts=N/SR/TB[am]`
    );
    if (hasAudio) {
      parts.push(`[a0][am]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
    } else {
      parts.push(`[am]anull[aout]`);
    }
    audioMapped = true;
  } else if (hasAudio) {
    parts.push(`[a0]anull[aout]`);
    audioMapped = true;
  }

  const args = ["-y", ...inputs, "-filter_complex", parts.join(";"), "-map", "[vout]"];
  if (audioMapped) args.push("-map", "[aout]");
  args.push("-r", String(settings.fps), "-t", dur.toFixed(2));

  if (settings.format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf("webm", settings.quality)));
    if (audioMapped) args.push("-c:a", "libopus", "-b:a", "128k");
    else args.push("-an");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf("mp4", settings.quality)), "-pix_fmt", "yuv420p");
    if (audioMapped) args.push("-c:a", "aac", "-b:a", "160k");
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
  void runExport(record, spec).catch((error) => {
    record.status = "error";
    record.error = error instanceof Error ? error.message : String(error);
  });
  return record;
}

async function runExport(record: ExportRecord, spec: ExportSpec) {
  const dir = path.join(workDir(spec.jobId), `export-${record.id}`);
  await mkdir(dir, { recursive: true });
  const { args, outFile } = await buildArgs(spec, dir);
  const total = Math.max(0.1, trimDuration(spec));

  await runFfmpeg(args, {
    onLine: (line) => {
      const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        record.progress = Math.min(99, Math.max(1, Math.round((t / total) * 100)));
      }
    }
  });

  // Never mark complete unless a real, probeable, non-empty file exists.
  const info = await stat(outFile).catch(() => null);
  if (!info || info.size < 1024) {
    throw new Error("Export finished but produced no usable video file.");
  }
  await probeDuration(outFile); // throws if the output is not a valid video
  record.file = path.basename(outFile);
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
