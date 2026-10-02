/**
 * Shared encode, scale and source-format settings for every master that ships.
 *
 * Shorts used to pull a 720p section and stretch it, then both the 9:16
 * render and the long-form body encoded with a fast preset that spends its
 * bits worst on burned captions and screenshare text. The platform then
 * re-encodes that softness. One place now owns the settings both paths
 * read: lanczos on every quality-critical scale, x264 medium / CRF 17,
 * AAC 320k.
 *
 * It also owns the two decisions upstream of any of that, because between them
 * they cost more picture than every encode setting here put together:
 *
 * 1. WHICH stream is downloaded. The old selectors ended in a bare `b`
 *    ("best single muxed file"), and on YouTube that is itag 18 — 640x360 at
 *    ~190 kbps. Whenever the adaptive tiers in front of it could not be served
 *    (SABR-only formats on the player client that finally answered), a whole
 *    three-hour stream came down at 360p with nothing in the app saying so.
 *    Every muxed fallback now sits BEHIND every adaptive tier.
 * 2. WHAT SIZE the render targets. 1920x1080 was hardcoded, so that 360p
 *    download was lanczos-upscaled to 1080p and encoded at CRF 17 — three
 *    times the pixels and none of the detail. `resolveOutputFrame` derives the
 *    frame from the source instead, and only ever scales down.
 *
 * Leaf module: pure functions over one other leaf (`outputQuality`), tested.
 */

import {
  DEFAULT_OUTPUT_QUALITY,
  outputFrameRateCap,
  outputHeightCap,
  type OutputQuality
} from "@/lib/pipeline/outputQuality";

export const MASTER_PRESET = "medium";
export const MASTER_CRF = 17;
export const MASTER_AUDIO_BITRATE = "320k";
export const SCALE_FLAGS = "lanczos+accurate_rnd+full_chroma_int";

/**
 * The encode for a file that exists only to be the input of another filter
 * pass. Near-transparent, so the single quality encode at the end of the chain
 * works from something indistinguishable from the render's own frames instead
 * of paying generation loss twice at CRF 17.
 *
 * The preset stays fast deliberately: at CRF 14 a slower preset buys file size,
 * not detail, and the pass it governs is a multi-hour stream body. `slow` would
 * double an already long export to protect what CRF 14 is not discarding.
 */
export const INTERMEDIATE_CRF = 14;
export const INTERMEDIATE_PRESET = "fast";

/** Highest short-side delivery size for a composed vertical export. */
export const MAX_VERTICAL_SHORT_SIDE = 2160;

/**
 * A yt-dlp format selector for a height ceiling. Every adaptive tier is tried
 * before any muxed one, because a muxed fallback is exactly how a 1440p stream
 * silently arrives as 360p.
 */
function formatSelector(cap: number | null): string {
  // Source quality must not discard an available 8K original before editing.
  // A chosen delivery ceiling prefers a smaller download, but exhausts adaptive
  // streams before accepting the host's often much smaller muxed fallback.
  if (cap === null) return "bv*+ba/b";
  return [
    `bv*[height<=${cap}]+ba`,
    "bv*+ba",
    `b[height<=${cap}]`,
    "b"
  ].join("/");
}

/** Format selector for a clip-section download at the chosen output quality. */
export function clipSectionFormat(quality: OutputQuality = DEFAULT_OUTPUT_QUALITY): string {
  return formatSelector(outputHeightCap(quality));
}

/** Format selector for a whole-VOD download at the chosen output quality. */
export function fullVideoFormat(quality: OutputQuality = DEFAULT_OUTPUT_QUALITY): string {
  return formatSelector(outputHeightCap(quality));
}

export const CLIP_SECTION_FORMAT = clipSectionFormat();
export const FULL_VIDEO_FORMAT = fullVideoFormat();

export function evenPixels(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(2, Math.round(value / 2) * 2);
}

export function scaleFilter(w: number | string, h: number | string, extra: string[] = []): string {
  return [`scale=${w}:${h}`, ...extra, `flags=${SCALE_FLAGS}`].join(":");
}

export function coverScale(w: number | string, h: number | string): string {
  return scaleFilter(w, h, ["force_original_aspect_ratio=increase"]);
}

export function containScale(w: number | string, h: number | string): string {
  return scaleFilter(w, h, ["force_original_aspect_ratio=decrease"]);
}

export function masterVideoArgs(crf: number = MASTER_CRF, preset: string = MASTER_PRESET): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    String(crf),
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p"
  ];
}

/** The encode for an intermediate that a later pass re-encodes. */
export function intermediateVideoArgs(): string[] {
  return masterVideoArgs(INTERMEDIATE_CRF, INTERMEDIATE_PRESET);
}

export function masterAudioArgs(): string[] {
  return ["-c:a", "aac", "-b:a", MASTER_AUDIO_BITRATE, "-ar", "48000", "-ac", "2"];
}

/** The picture a render is working from. Zeroes mean "could not probe". */
export type SourceFrame = { width: number; height: number; fps: number };

/** The frame a render targets: size, and the frame rate every stage is locked to. */
export type OutputFrame = { width: number; height: number; fps: number };

const FALLBACK_HEIGHT = 1080;
const FALLBACK_FPS = 30;
/** Legacy delivery size retained for sources below full HD. */
const VERTICAL_SHORT_SIDE = 1080;

/**
 * The frame a render should target for a source and a quality choice.
 *
 * "source" keeps the recording's own geometry and frame rate. Numeric choices
 * are ceilings: a 720p neutral master asked for 4K stays 720p, and a 30 fps
 * source asked for 60 stays 30. A vertical composition may scale footage to
 * fill its delivery canvas; those extra pixels cannot add source detail.
 *
 * `wide` returns a 16:9 canvas (letterboxed by the caller when the source is a
 * different shape, widened when the source is wider than 16:9 so an ultrawide
 * keeps its pixels). `vertical` returns a 9:16 canvas whose short side never
 * exceeds the source width, up to a 4K vertical delivery canvas. `source` keeps
 * the original aspect ratio for a neutral master without padding.
 */
export function resolveOutputFrame(
  source: SourceFrame,
  quality: OutputQuality = DEFAULT_OUTPUT_QUALITY,
  shape: "wide" | "vertical" | "source" = "wide"
): OutputFrame {
  const srcH = source.height > 0 ? source.height : FALLBACK_HEIGHT;
  const srcW = source.width > 0 ? source.width : Math.round((srcH * 16) / 9);
  const srcFps = source.fps > 0 ? source.fps : FALLBACK_FPS;

  const heightCap = outputHeightCap(quality);
  // A portrait recording's resolution is its short side, just as 2160p means
  // 3840x2160 in landscape. Capping its long side would halve real 4K pixels.
  const resolutionSide = shape === "wide" ? srcH : Math.min(srcW, srcH);
  const factor = heightCap ? Math.min(1, heightCap / resolutionSide) : 1;
  const fitH = evenPixels(srcH * factor);
  const fitW = evenPixels(srcW * factor);

  const fpsCap = outputFrameRateCap(quality);
  const fps = Math.round(Math.min(srcFps, fpsCap ?? srcFps) * 1000) / 1000;

  if (shape === "vertical") {
    const width = evenPixels(Math.min(
      MAX_VERTICAL_SHORT_SIDE,
      fitW,
      Math.max(VERTICAL_SHORT_SIDE, fitH),
      heightCap ?? MAX_VERTICAL_SHORT_SIDE
    ));
    return { width, height: evenPixels((width * 16) / 9), fps };
  }
  return { width: shape === "source" ? fitW : Math.max(fitW, evenPixels((fitH * 16) / 9)), height: fitH, fps };
}
