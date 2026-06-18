import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ensureYtDlp, runYtDlp } from "@/lib/clipping/download";
import { parseSubtitles } from "@/lib/clipping/captions";
import type { CaptionSegment } from "@/types/domain";

/**
 * Fetches automatic captions for a source video using yt-dlp's subtitle
 * support — no separate transcription model or API key. Many platforms
 * (YouTube in particular) expose machine-generated captions with word-level
 * timing, which we parse into editable phrase segments.
 *
 * This intentionally reuses the yt-dlp binary the clipping pipeline already
 * downloads, so it adds no new transcription dependency.
 */
export async function fetchAutoCaptions(url: string, destDir: string): Promise<CaptionSegment[]> {
  const bin = await ensureYtDlp();
  const template = path.join(destDir, "subs.%(ext)s");

  // Prefer real uploaded subs, fall back to auto-generated ("auto-subs").
  await runYtDlp(
    [
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en.*,en",
      "--sub-format",
      "vtt/best",
      "--no-playlist",
      "--no-warnings",
      "-o",
      template,
      url
    ],
    bin,
    { allowFailure: true }
  );

  const entries = await readdir(destDir).catch(() => [] as string[]);
  const vttFile = entries.find((name) => name.startsWith("subs") && name.endsWith(".vtt"));
  if (!vttFile) {
    throw new Error(
      "No automatic captions are available for this source. You can still add and edit captions manually."
    );
  }

  const content = await readFile(path.join(destDir, vttFile), "utf8");
  const segments = parseSubtitles(content);
  // Clean up the downloaded subtitle artifacts.
  for (const name of entries) {
    if (name.startsWith("subs") && name.endsWith(".vtt")) {
      await rm(path.join(destDir, name), { force: true }).catch(() => undefined);
    }
  }
  if (segments.length === 0) {
    throw new Error("Captions were downloaded but could not be parsed. Add captions manually instead.");
  }
  return segments;
}
