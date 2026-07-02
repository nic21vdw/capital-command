import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { DEFAULT_CLIP_LAYOUT, resolveClipLayout, type LayoutLayer, type Rect } from "@/lib/clipping/layouts";
import type { ClipLayoutOverrides, ClipLayoutPreset } from "@/lib/clipping/types";

const FRAME_W = 1080;
const FRAME_H = 1920;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rectExpr(rect: Rect) {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const w = Math.max(0.01, Math.min(1 - x, rect.w));
  const h = Math.max(0.01, Math.min(1 - y, rect.h));
  return {
    x: `iw*${x.toFixed(4)}`,
    y: `ih*${y.toFixed(4)}`,
    w: `iw*${w.toFixed(4)}`,
    h: `ih*${h.toFixed(4)}`
  };
}

function pixelRect(rect: Rect) {
  return {
    x: Math.round(FRAME_W * clamp01(rect.x)),
    y: Math.round(FRAME_H * clamp01(rect.y)),
    w: Math.max(2, Math.round(FRAME_W * Math.max(0.01, Math.min(1, rect.w)))),
    h: Math.max(2, Math.round(FRAME_H * Math.max(0.01, Math.min(1, rect.h))))
  };
}

function layerChain(layer: LayoutLayer, layerName: string) {
  const src = rectExpr(layer.source);
  const dest = pixelRect(layer.dest);
  const crop = `[0:v]crop=${src.w}:${src.h}:${src.x}:${src.y}`;
  const fitted =
    layer.fit === "contain"
      ? `scale=${dest.w}:${dest.h}:force_original_aspect_ratio=decrease,pad=${dest.w}:${dest.h}:(ow-iw)/2:(oh-ih)/2:color=0x050914`
      : `scale=${dest.w}:${dest.h}:force_original_aspect_ratio=increase,crop=${dest.w}:${dest.h}`;

  return {
    dest,
    filter: `${crop},${fitted},setsar=1[${layerName}]`
  };
}

/**
 * Builds a reframe filter chain that crops the source to fill a target WxH.
 * A blurred, dimmed cover of the source remains behind the crop so aggressive
 * pans/zooms never expose black edges.
 *
 * `inLabel` is consumed and `outLabel` produced inside a filter_complex.
 */
export function reframeChain(
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
  const cropX = `(iw-${w})/2+${sx.toFixed(4)}*(iw-${w})/2`;
  const cropY = `(ih-${h})/2+${sy.toFixed(4)}*(ih-${h})/2`;
  return (
    `[${inLabel}]split=2[__bg][__fg];` +
    `[__bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:4,eq=brightness=-0.08[__bgb];` +
    `[__fg]scale=${w}:${h}:force_original_aspect_ratio=increase,scale=iw*${cropScale}:ih*${cropScale},crop=${w}:${h}:x='${cropX}':y='${cropY}'[__fgs];` +
    `[__bgb][__fgs]overlay=0:0[${outLabel}]`
  );
}

/**
 * Renders the selected source range as a neutral 16:9 master clip. The full
 * source frame is preserved with contain scaling so any later vertical,
 * square, or portrait crop can be made non-destructively from this file.
 */
export async function renderSourceClip(inputPath: string, outputPath: string, audioPresent: boolean) {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x050914,setsar=1,format=yuv420p[vout]",
    "-map",
    "[vout]",
    ...(audioPresent ? ["-map", "0:a?"] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    ...(audioPresent ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"]),
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

/**
 * Renders a 9:16 vertical clip (Shorts/Reels/TikTok) with the source centered
 * over a blurred, dimmed fill of itself so nothing is cropped away. The input
 * is already trimmed to the clip range, so the whole file is rendered.
 */
export async function renderVertical(inputPath: string, outputPath: string, audioPresent: boolean) {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    // Downscale the blurred background before blurring (cheaper) and use a
    // lighter boxblur — visually equivalent to the old 24:4 but much faster.
    "[0:v]split=2[bg][fg];" +
      "[bg]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=12:2,eq=brightness=-0.08,scale=1080:1920[bgb];" +
      "[fg]scale=1080:-2[fgs];" +
      "[bgb][fgs]overlay=(W-w)/2:(H-h)/2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    ...(audioPresent ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

export function stackedLayoutChain(layout: ClipLayoutPreset, layoutOverrides?: ClipLayoutOverrides): string {
  const definition = resolveClipLayout(layout, layoutOverrides);
  if (definition.layers.length === 0) {
    return (
      "[0:v]split=2[bg][fg];" +
      "[bg]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=12:2,eq=brightness=-0.08,scale=1080:1920[bgb];" +
      "[fg]scale=1080:-2[fgs];" +
      "[bgb][fgs]overlay=(W-w)/2:(H-h)/2[vout]"
    );
  }

  const parts: string[] = [
    "[0:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=12:2,eq=brightness=-0.12,scale=1080:1920,format=yuv420p[base]"
  ];
  let last = "base";
  definition.layers.forEach((layer, index) => {
    const layerName = `ly${index}`;
    const next = `mix${index}`;
    const { dest, filter } = layerChain(layer, layerName);
    parts.push(filter);
    parts.push(`[${last}][${layerName}]overlay=${dest.x}:${dest.y}:format=auto[${next}]`);
    last = next;
  });
  parts.push(`[${last}]format=yuv420p[vout]`);
  return parts.join(";");
}

export async function renderClipLayout(
  inputPath: string,
  outputPath: string,
  audioPresent: boolean,
  layout: ClipLayoutPreset = DEFAULT_CLIP_LAYOUT,
  layoutOverrides?: ClipLayoutOverrides
) {
  if (layout === "center" && !layoutOverrides?.center) {
    await renderVertical(inputPath, outputPath, audioPresent);
    return;
  }

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    stackedLayoutChain(layout, layoutOverrides),
    "-map",
    "[vout]",
    ...(audioPresent ? ["-map", "0:a?"] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    ...(audioPresent ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]),
    "-movflags",
    "+faststart",
    outputPath
  ]);
}
