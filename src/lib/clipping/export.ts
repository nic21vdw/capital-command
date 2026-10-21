import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { clipProjectSchema } from "@/lib/storage/schemas";
import { brandKit } from "@/lib/brand/kit";
import { shortsAudioArgs, shortsAudioFilter } from "@/lib/clipping/audio";
import { containScale, masterVideoArgs, scaleFilter } from "@/lib/clipping/encode";
import { buildAss, buildTextOverlayDialogue, buildWatermarkDialogue } from "@/lib/clipping/captions";
import { hasAudioStream, isRenderCanceled, parseVideoStreamInfo, probeDuration, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { attachEditedClipRender, outputDir, workDir } from "@/lib/clipping/jobs";
import { renderSignature } from "@/lib/clipping/export-signature";
import { removeQuietly } from "@/lib/disk/cleanup";
import { renderFailureMessage } from "@/lib/disk/space";
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
import { assFilter } from "@/lib/clipping/caption-fonts";

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
  return ranges.map((range) => ranges.length === 1
    ? `between(t,${range.start.toFixed(3)},${range.end.toFixed(3)})`
    : `gte(t,${range.start.toFixed(3)})*lt(t,${range.end.toFixed(3)})`).join("+");
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
    spec.captionsVisible && spec.settings.burnCaptions ? captions : [],
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
          color: o.color ?? brandKit().palette.purple,
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

async function buildArgs(spec: ExportSpec, dir: string, preparation?: { sourcePath: string; outFile: string }): Promise<{ args: string[]; outFile: string }> {
  const { settings } = spec;
  const w = settings.width;
  const h = settings.height;
  const basePath = preparation?.sourcePath ?? path.join(outputDir(spec.jobId), spec.sourceFile);
  const dur = trimDuration(spec);
  if (dur < 0.05) throw new Error("Nothing to export — every timeline segment is cut.");
  const selectExpr = selectExpression(spec);
  const hasAudio = preparation ? (await probePreparationMedia(basePath)).hasAudio
    : await hasAudioStream(basePath).catch(() => false);

  const images = await writeOverlayImages(spec, dir);
  const assPath = path.join(dir, "subs.ass");
  await writeFile(assPath, buildExportAss(spec, w, h), "utf8");

  const ext = settings.format === "webm" ? "webm" : "mp4";
  const outFile = preparation?.outFile ?? path.join(outputDir(spec.jobId), `export-${path.basename(dir)}.${ext}`);

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
  parts.push(`[${last}]${assFilter(assPath, escapeFilterPath)}[vout]`);

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

/** Internal owner-worker capability. Never construct from an HTTP export body. */
export type PreparationExportBinding = {
  ownerId: string; projectId: string; jobId: string; clipId: string; sourceFile: string;
  sourceSha256: string; projectDigest: string; specSha256: string; renderSignature: string;
  requestId: string; attemptId: string;
};
export type PreparationExportCurrent = { binding: PreparationExportBinding; spec: ExportSpec };
/** Streaming-only identity guard; never accepted as an export-outcome proof. */
export type PreparationArtifactRead = PreparationExportBinding & {
  exportId: string; file: string; durationSec: number; bytes: number; artifactSha256: string;
  assertCurrent(): void;
};
export type PreparationExportProof = PreparationArtifactRead & {
  /** Rechecks current filesystem identity and bytes without yielding inside a store lock. */
  assertCurrent(): void;
  verifyCurrent(): Promise<void>;
  streamingRead(): PreparationArtifactRead;
};

function canonicalPreparationJson(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Preparation numbers must be finite.");
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalPreparationJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, field]) => `${JSON.stringify(key)}:${canonicalPreparationJson(field)}`).join(",")}}`;
}
export const preparationSpecDigest = (spec: ExportSpec): string => createHash("sha256")
  .update(canonicalPreparationJson(spec)).digest("hex");

const preparationSpecSchema = clipProjectSchema.pick({ jobId: true, sourceFile: true, baseDurationSec: true,
  trimStart: true, trimEnd: true, segments: true, compositionMode: true, reframe: true,
  faceSource: true, screenSource: true, captions: true, captionStyle: true, captionsVisible: true,
  highlightCurrentWord: true, overlays: true, audio: true, sfx: true
}).extend({ settings: clipProjectSchema.shape.exportSettings }).strict();
const preparationId = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const preparationUuid = (value: string): boolean => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const preparationFile = (value: string): boolean => typeof value === "string" && value.length <= 255
  && /^[A-Za-z0-9][A-Za-z0-9_. -]*\.(?:mp4|webm|mov|mkv)$/i.test(value) && !value.endsWith(".");

/** Checks every ancestor, including Windows junctions, before using a derived path. */
function assertPreparationPath(target: string, allowMissing = false): void {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const segment of absolute.slice(root.length).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink() || path.resolve(realpathSync(current)).toLowerCase() !== current.toLowerCase()) {
        throw new Error("Preparation paths must not contain symlinks or junctions.");
      }
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}
function preparationFileIdentity(file: string): { bytes: number; identity: string } {
  assertPreparationPath(file);
  const info = lstatSync(file, { bigint: true });
  if (!info.isFile() || info.nlink !== 1n) throw new Error("Preparation requires an independent regular media file.");
  return { bytes: Number(info.size), identity: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` };
}
function preparationFileHash(file: string): { sha256: string; bytes: number; identity: string } {
  const before = preparationFileIdentity(file);
  const fd = openSync(file, "r");
  const hash = createHash("sha256");
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let count: number;
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count));
  } finally { closeSync(fd); }
  if (before.identity !== preparationFileIdentity(file).identity) throw new Error("Preparation media changed while being verified.");
  return { sha256: hash.digest("hex"), ...before };
}

async function probePreparationMedia(file: string) {
  assertPreparationPath(file);
  const header = Buffer.alloc(12);
  const fd = openSync(file, "r");
  try { readSync(fd, header, 0, header.length, 0); } finally { closeSync(fd); }
  if (header.toString("ascii", 4, 8) !== "ftyp" && header.readUInt32BE(0) !== 0x1a45dfa3) {
    throw new Error("Preparation media is not a supported local video container.");
  }
  // Constrain probes too: demuxer sniffing must never turn a disguised playlist
  // into a network request before the render's own protocol whitelist applies.
  const { stderr } = await runFfmpeg(["-protocol_whitelist", "file", "-hide_banner", "-i", file], { allowFailure: true });
  const video = parseVideoStreamInfo(stderr);
  if (!video || !video.durationSec || video.durationSec <= 0) throw new Error("Preparation media is not a probeable local video.");
  return { ...video, durationSec: video.durationSec, hasAudio: /Stream #\d+:\d+.*Audio/.test(stderr) };
}

async function preparationContext(
  trusted: PreparationExportBinding,
  readCurrent: () => Promise<PreparationExportCurrent>
) {
  const binding = structuredClone(trusted);
  if (!binding.ownerId?.trim() || binding.ownerId.length > 128
    || ![binding.projectId, binding.jobId, binding.clipId].every(preparationId)
    || !preparationFile(binding.sourceFile) || ![binding.requestId, binding.attemptId].every(preparationUuid)
    || ![binding.sourceSha256, binding.projectDigest, binding.specSha256].every((hash) => /^[a-f0-9]{64}$/.test(hash))
    || !/^[a-z0-9]{1,64}$/.test(binding.renderSignature)) throw new Error("An explicit trusted preparation binding is required.");
  const root = path.resolve(dataPath("clips"));
  const sourcePath = path.join(root, "outputs", binding.jobId, binding.sourceFile);
  // Keep libass paths below Windows' legacy MAX_PATH limit, including under a
  // sandbox's long temp root. The full trusted identities remain in the proof.
  const attemptKey = createHash("sha256").update(canonicalPreparationJson({ ownerId: binding.ownerId,
    jobId: binding.jobId, attemptId: binding.attemptId })).digest("hex").slice(0, 32);
  const dir = path.join(root, "preparations", attemptKey);
  const scratch = path.join(dir, "scratch");
  const assertRoot = () => {
    if (path.resolve(dataPath("clips")) !== root) throw new Error("The preparation data root changed.");
    assertPreparationPath(root);
  };
  const checkCurrent = async (): Promise<ExportSpec> => {
    const current = await readCurrent();
    if (canonicalPreparationJson(current.binding) !== canonicalPreparationJson(binding)) throw new Error("The preparation source, project or attempt changed.");
    const parsed = preparationSpecSchema.parse(current.spec) as ExportSpec;
    if (canonicalPreparationJson(parsed).length > 4_000_000 || preparationSpecDigest(parsed) !== binding.specSha256
      || preparationSpecDigest(current.spec) !== binding.specSha256 || renderSignature(parsed) !== binding.renderSignature
      || parsed.jobId !== binding.jobId || parsed.sourceFile !== binding.sourceFile) throw new Error("The preparation render spec changed.");
    if (parsed.audio.musicSrc || parsed.overlays.some((overlay) => overlay.kind !== "text" || overlay.src)
      || parsed.sfx?.enabled || parsed.settings.separateSubtitle) throw new Error("This preparation requires an unsupported asset or subtitle capability.");
    if (!/^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$/.test(parsed.settings.filename)
      || parsed.settings.width % 2 || parsed.settings.height % 2) throw new Error("The preparation export settings are unsupported.");
    const end = parsed.trimEnd || parsed.baseDurationSec;
    if (!(parsed.baseDurationSec > 0) || parsed.trimStart >= end || end > parsed.baseDurationSec
      || [...parsed.captions, ...parsed.overlays, ...(parsed.segments ?? [])].some((row) => row.end < row.start || row.end > parsed.baseDurationSec)
      || parsed.captions.some((caption) => caption.words.some((word) => word.end < word.start || word.end > parsed.baseDurationSec))) {
      throw new Error("The preparation timeline is outside its original source.");
    }
    assertRoot();
    if (preparationFileHash(sourcePath).sha256 !== binding.sourceSha256) throw new Error("The preparation source bytes changed.");
    return structuredClone(parsed);
  };
  const spec = await checkCurrent();
  const source = preparationFileHash(sourcePath);
  return { binding, spec, source, sourcePath, dir, scratch, assertRoot, checkCurrent,
    file: path.join(dir, `prepared.${spec.settings.format}`) };
}

async function readPreparationProof(context: Awaited<ReturnType<typeof preparationContext>>): Promise<PreparationExportProof> {
  const { binding, spec, source, sourcePath, file, assertRoot, checkCurrent } = context;
  const output = preparationFileHash(file);
  if (output.bytes < 1024) throw new Error("Preparation produced no usable video file.");
  const media = await probePreparationMedia(file);
  const durationSec = media.durationSec;
  if (Math.abs(durationSec - trimDuration(spec)) > Math.max(0.25, 2 / spec.settings.fps)) throw new Error("The preparation output duration does not match its render spec.");
  if (media.width !== spec.settings.width || media.height !== spec.settings.height) throw new Error("The preparation output dimensions do not match its render spec.");
  const assertCurrent = () => {
    assertRoot();
    const currentSource = preparationFileHash(sourcePath);
    const currentOutput = preparationFileHash(file);
    if (currentSource.sha256 !== binding.sourceSha256 || currentSource.identity !== source.identity
      || currentOutput.sha256 !== output.sha256 || currentOutput.identity !== output.identity) throw new Error("The verified preparation media changed.");
  };
  const verifyCurrent = async () => { await checkCurrent(); assertCurrent(); };
  await verifyCurrent();
  const artifact = { ...binding, exportId: `preparation-${binding.attemptId}`, file, durationSec,
    bytes: output.bytes, artifactSha256: output.sha256 };
  const streamingRead = (): PreparationArtifactRead => {
    const assertStreamingCurrent = () => {
      assertRoot();
      if (preparationFileIdentity(sourcePath).identity !== source.identity
        || preparationFileIdentity(file).identity !== output.identity) throw new Error("The streaming preparation media identity changed.");
    };
    assertStreamingCurrent();
    return Object.freeze({ ...artifact, assertCurrent: assertStreamingCurrent });
  };
  return Object.freeze({ ...artifact, assertCurrent, verifyCurrent, streamingRead });
}

/** Read-only proof recovery, bound to the hash committed by the trusted worker. */
export async function verifyPreparedClipExport(
  binding: PreparationExportBinding, readCurrent: () => Promise<PreparationExportCurrent>,
  expected: { exportId: string; artifactSha256: string }
): Promise<PreparationExportProof> {
  if (expected.exportId !== `preparation-${binding.attemptId}` || !/^[a-f0-9]{64}$/.test(expected.artifactSha256)) {
    throw new Error("The persisted preparation artifact identity is invalid.");
  }
  const proof = await readPreparationProof(await preparationContext(binding, readCurrent));
  if (proof.artifactSha256 !== expected.artifactSha256) throw new Error("The persisted preparation artifact bytes changed.");
  return proof;
}

/**
 * Render-only worker entry: reuses the original editor's pixel/audio pipeline,
 * but never registers an export, attaches a clip, enqueues, schedules or sends.
 * The trusted loader must re-read the exact claimed original project/job/clip.
 */
export async function prepareClipExport(
  trusted: PreparationExportBinding,
  readCurrent: () => Promise<PreparationExportCurrent>,
  options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {}
): Promise<PreparationExportProof> {
  const context = await preparationContext(trusted, readCurrent);
  const { spec, sourcePath, dir, scratch, file, checkCurrent } = context;
  assertPreparationPath(dir, true);
  // Exclusive attempt directory: retries never overwrite an uncertain artifact.
  await mkdir(path.dirname(dir), { recursive: true });
  assertPreparationPath(path.dirname(dir));
  await mkdir(dir);
  assertPreparationPath(dir);
  await mkdir(scratch);
  try {
    assertPreparationPath(path.join(process.cwd(), "public", "fonts", "captions"), true);
    const { args } = await buildArgs(spec, scratch, { sourcePath, outFile: file });
    await checkCurrent();
    assertPreparationPath(scratch);
    assertPreparationPath(file, true);
    let lastProgress = 0;
    await runFfmpeg(["-protocol_whitelist", "file", ...args], { signal: options.signal, onLine: (line) => {
      const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match || options.signal?.aborted) return;
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      const progress = Math.max(lastProgress, Math.min(99, Math.floor(seconds / trimDuration(spec) * 100)));
      if (progress > lastProgress) { lastProgress = progress; options.onProgress?.(progress); }
    } });
    const proof = await readPreparationProof(context);
    options.onProgress?.(100);
    return proof;
  } catch (error) {
    assertPreparationPath(dir);
    await rm(file, { force: true });
    throw error;
  } finally {
    assertPreparationPath(scratch);
    await rm(scratch, { recursive: true, force: true });
  }
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
      record.error = renderFailureMessage(error);
    })
    .finally(() => controllers.delete(id));
  return record;
}

async function runExport(record: ExportRecord, spec: ExportSpec, signal: AbortSignal) {
  const dir = path.join(workDir(spec.jobId), `export-${record.id}`);
  await mkdir(dir, { recursive: true });
  try {
    await renderToFile(record, spec, dir, signal);
  } finally {
    await removeQuietly(dir);
  }
}

async function renderToFile(record: ExportRecord, spec: ExportSpec, dir: string, signal: AbortSignal) {
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
    // A stop or a failure leaves a half-written output; remove it so nothing
    // downstream ever picks up a truncated, unplayable file.
    await rm(outFile, { force: true }).catch(() => undefined);
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
