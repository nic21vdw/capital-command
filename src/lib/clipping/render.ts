import { runFfmpeg } from "@/lib/clipping/ffmpeg";

/**
 * Builds a reframe filter chain that fits the source into a target WxH without
 * cropping content away: a blurred, dimmed cover of the source fills the frame
 * and the (optionally zoomed/panned) source is overlaid on top. Works for any
 * aspect ratio, so a 9:16 clip can be reframed to 16:9, 1:1, 4:5, etc.
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
  const fgScale = Math.max(0.1, scale);
  // Pan within the spare space: offset -1..1 maps to the frame edges.
  const dx = `(W-w)/2+${(offsetX * 0.5).toFixed(4)}*(W-w)`;
  const dy = `(H-h)/2+${(offsetY * 0.5).toFixed(4)}*(H-h)`;
  return (
    `[${inLabel}]split=2[__bg][__fg];` +
    `[__bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:4,eq=brightness=-0.08[__bgb];` +
    `[__fg]scale=iw*${fgScale}:ih*${fgScale},scale='min(${w},iw)':'min(${h},ih)':force_original_aspect_ratio=decrease[__fgs];` +
    `[__bgb][__fgs]overlay=${dx}:${dy}[${outLabel}]`
  );
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
    "[0:v]split=2[bg][fg];" +
      "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4,eq=brightness=-0.08[bgb];" +
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
