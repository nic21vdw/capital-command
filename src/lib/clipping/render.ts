import { runFfmpeg } from "@/lib/clipping/ffmpeg";

/** Optional input trim. When omitted, the whole input file is rendered. */
export type RenderRange = { start: number; duration: number };

// Input-seek (before -i) is fast and accurate enough for clip boundaries.
const seekArgs = (range?: RenderRange) =>
  range ? ["-ss", String(range.start), "-t", String(range.duration)] : [];

const audioArgs = (audioPresent: boolean) =>
  audioPresent ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"];

/**
 * Renders a 9:16 vertical clip (Shorts/Reels/TikTok) with the source centered
 * over a blurred, dimmed fill of itself so nothing is cropped away.
 */
export async function renderVertical(
  inputPath: string,
  outputPath: string,
  audioPresent: boolean,
  range?: RenderRange
) {
  await runFfmpeg([
    "-y",
    ...seekArgs(range),
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
    ...audioArgs(audioPresent),
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

/**
 * Renders a 16:9 widescreen clip (long-form), letterboxing if the source is
 * not already 16:9 so the full frame is preserved.
 */
export async function renderWide(
  inputPath: string,
  outputPath: string,
  audioPresent: boolean,
  range?: RenderRange
) {
  await runFfmpeg([
    "-y",
    ...seekArgs(range),
    "-i",
    inputPath,
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=decrease," +
      "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    ...audioArgs(audioPresent),
    "-movflags",
    "+faststart",
    outputPath
  ]);
}
