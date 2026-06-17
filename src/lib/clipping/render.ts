import { runFfmpeg } from "@/lib/clipping/ffmpeg";

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
