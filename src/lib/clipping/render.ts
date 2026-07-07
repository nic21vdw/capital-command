import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { DEFAULT_CLIP_LAYOUT, resolveClipLayout, withLayerSources, type LayoutLayer, type Rect } from "@/lib/clipping/layouts";
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

function pixelRect(rect: Rect, frameW: number, frameH: number) {
  return {
    x: Math.round(frameW * clamp01(rect.x)),
    y: Math.round(frameH * clamp01(rect.y)),
    w: Math.max(2, Math.round(frameW * Math.max(0.01, Math.min(1, rect.w)))),
    h: Math.max(2, Math.round(frameH * Math.max(0.01, Math.min(1, rect.h))))
  };
}

function layerChain(layer: LayoutLayer, layerName: string, frameW: number, frameH: number) {
  const src = rectExpr(layer.source);
  const dest = pixelRect(layer.dest, frameW, frameH);
  const crop = `[0:v]crop=${src.w}:${src.h}:${src.x}:${src.y}`;
  // `contain` layers are NOT padded: they float centered inside their dest
  // rect so the blurred base shows through the letterbox instead of a box.
  const fitted =
    layer.fit === "contain"
      ? `scale=${dest.w}:${dest.h}:force_original_aspect_ratio=decrease`
      : `scale=${dest.w}:${dest.h}:force_original_aspect_ratio=increase,crop=${dest.w}:${dest.h}`;

  return {
    // Center the (possibly smaller) fitted layer inside its dest rect.
    overlayX: `${dest.x}+(${dest.w}-w)/2`,
    overlayY: `${dest.y}+(${dest.h}-h)/2`,
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
 * Like {@link reframeChain}, but the punch-in *animates* from no zoom (1x) up to
 * `targetScale` over the first `rampSec` seconds instead of starting already
 * fully zoomed. The ramp uses an ease-out cubic curve — fast then settling —
 * so the opening of the clip glides into the zoom the way the editor preview's
 * CSS transition does, rather than snapping at the very first frame.
 *
 * The zoom is driven by ffmpeg's per-frame `t` (seconds from the clip start),
 * so the whole thing bakes in a single pass. Once `t >= rampSec` the crop holds
 * steady at `targetScale` for the rest of the clip.
 *
 * The zoom lives in a per-frame `scale` (which supports `eval=frame`, so its
 * dimensions may depend on `t`) rather than in the crop's size: a crop's output
 * width/height are evaluated ONCE at init, where `t` is undefined, so a
 * `t`-dependent crop size fails to configure the filter ("Error when evaluating
 * the expression … Failed to configure input pad"). We instead scale the cover
 * frame up by z(t) each frame and crop a fixed-size viewport back out at the
 * focus point (crop's x/y DO support `eval=frame`).
 */
export function animatedReframeChain(
  inLabel: string,
  outLabel: string,
  w: number,
  h: number,
  targetScale = 1,
  offsetX = 0,
  offsetY = 0,
  rampSec = 0.5
): string {
  const target = Math.max(1, targetScale);
  const sx = Math.max(-1, Math.min(1, offsetX));
  const sy = Math.max(-1, Math.min(1, offsetY));
  const ramp = Math.max(0.05, rampSec);

  // No zoom requested: nothing to animate, fall back to the plain cover crop.
  if (target <= 1.001) {
    return reframeChain(inLabel, outLabel, w, h, 1, offsetX, offsetY);
  }

  // z(t): 1 -> target over `ramp` seconds on an ease-out cubic (1-(1-p)^3),
  // then held. Commas inside function calls are safe because each option value
  // is single-quoted below.
  const progress = `min(1,t/${ramp.toFixed(3)})`;
  const z = `(1+${(target - 1).toFixed(4)}*(1-pow(1-${progress},3)))`;
  // Scale the cover frame up by z(t) each frame (scale's eval=frame lets the
  // size track `t`; dimensions are forced even so libx264 / yuv420p stay
  // happy), then crop a fixed WxH viewport back out around the focus point.
  // crop re-evaluates its x/y per frame by default — as the scaled-up `iw`/`ih`
  // grow, the viewport re-centers on the focus — while its output size stays
  // constant, which is the whole point (a `t`-dependent crop size fails to
  // configure). We deliberately don't pass crop's `eval` option: it only exists
  // to opt OUT of per-frame x/y, and older builds lack it entirely.
  const scaledW = `ceil(${w}*${z}/2)*2`;
  const scaledH = `ceil(${h}*${z}/2)*2`;
  const cropX = `(iw-ow)/2*(1+${sx.toFixed(4)})`;
  const cropY = `(ih-oh)/2*(1+${sy.toFixed(4)})`;
  return (
    `[${inLabel}]split=2[__bg][__fg];` +
    `[__bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:4,eq=brightness=-0.08[__bgb];` +
    `[__fg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      `scale=w='${scaledW}':h='${scaledH}':eval=frame,` +
      `crop=${w}:${h}:x='${cropX}':y='${cropY}'[__fgs];` +
    `[__bgb][__fgs]overlay=0:0[${outLabel}]`
  );
}

/**
 * Publishes instant preview assets for a freshly cut section, before the slow
 * HD master render runs:
 * - a stream-copy remux with `+faststart` (no re-encode, sub-second) that the
 *   browser can start playing immediately, and
 * - a poster frame so players paint a real image instantly instead of black.
 *
 * The preview holds the exact same content the master will contain — the
 * master is a re-encode of this same section — so what the user previews is
 * what they get.
 */
export async function renderPreviewAssets(inputPath: string, previewPath: string, posterPath: string) {
  // `+faststart` is an MP4-muxer option; WebM sections are copied as-is.
  const isMp4 = previewPath.toLowerCase().endsWith(".mp4");
  await runFfmpeg(["-y", "-i", inputPath, "-c", "copy", ...(isMp4 ? ["-movflags", "+faststart"] : []), previewPath]);
  await runFfmpeg([
    "-y",
    "-ss",
    "0.4",
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-2",
    "-q:v",
    "4",
    posterPath
  ]);
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

/** Escapes a filesystem path for use inside an ffmpeg filtergraph argument. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Renders the ready-to-post download clip the Clip Generator hands back by
 * default: a 9:16 vertical centered over a blurred, dimmed fill of itself
 * (nothing cropped away), with an optional burned-in ASS overlay carrying the
 * word-synced captions and the CoLateral watermark. `assPath` is a subtitle
 * document to burn in; pass null to render the composition alone.
 */
export async function renderCaptionedVertical(
  inputPath: string,
  outputPath: string,
  assPath: string | null,
  audioPresent: boolean
) {
  const composition =
    "[0:v]split=2[bg][fg];" +
    "[bg]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=12:2,eq=brightness=-0.08,scale=1080:1920[bgb];" +
    "[fg]scale=1080:-2[fgs];" +
    "[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[vc]";
  const filter = assPath
    ? `${composition};[vc]ass='${escapeFilterPath(assPath)}'[vout]`
    : `${composition};[vc]null[vout]`;
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filter,
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

export function stackedLayoutChain(
  layout: ClipLayoutPreset,
  layoutOverrides?: ClipLayoutOverrides,
  frameW: number = FRAME_W,
  frameH: number = FRAME_H,
  faceSource?: Rect,
  screenSource?: Rect
): string {
  const definition = withLayerSources(resolveClipLayout(layout, layoutOverrides), {
    face: faceSource,
    screen: screenSource
  });
  const blurW = Math.max(2, Math.round(frameW / 2));
  const blurH = Math.max(2, Math.round(frameH / 2));
  if (definition.layers.length === 0) {
    return (
      "[0:v]split=2[bg][fg];" +
      `[bg]scale=${blurW}:${blurH}:force_original_aspect_ratio=increase,crop=${blurW}:${blurH},boxblur=12:2,eq=brightness=-0.08,scale=${frameW}:${frameH}[bgb];` +
      `[fg]scale=${frameW}:-2[fgs];` +
      "[bgb][fgs]overlay=(W-w)/2:(H-h)/2[vout]"
    );
  }

  const parts: string[] = [
    `[0:v]split=${definition.layers.length + 1}[base0]` +
      definition.layers.map((_, index) => `[in${index}]`).join(""),
    `[base0]scale=${blurW}:${blurH}:force_original_aspect_ratio=increase,crop=${blurW}:${blurH},boxblur=12:2,eq=brightness=-0.12,scale=${frameW}:${frameH},format=yuv420p[base]`
  ];
  let last = "base";
  definition.layers.forEach((layer, index) => {
    const layerName = `ly${index}`;
    const next = `mix${index}`;
    const { overlayX, overlayY, filter } = layerChain(layer, layerName, frameW, frameH);
    parts.push(filter.replace("[0:v]", `[in${index}]`));
    parts.push(`[${last}][${layerName}]overlay=${overlayX}:${overlayY}:format=auto[${next}]`);
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
