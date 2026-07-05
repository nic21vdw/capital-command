import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { downloadAudio, ensureYtDlp, runYtDlp } from "@/lib/clipping/download";
import { parseSubtitles } from "@/lib/clipping/captions";
import { transcribeMedia } from "@/lib/clipping/whisper";
import type { CaptionSegment } from "@/types/domain";

/**
 * Fetches automatic captions for a source video using yt-dlp's subtitle
 * support — no separate transcription model or API key. Many platforms
 * (YouTube in particular) expose machine-generated captions with word-level
 * timing, which we parse into editable phrase segments.
 *
 * This intentionally reuses the yt-dlp binary the clipping pipeline already
 * downloads, so it adds no new transcription dependency.
 *
 * Returns an empty array when the platform has no captions (or they can't be
 * parsed) — callers fall back to local Whisper transcription via
 * fetchSourceCaptions rather than giving up.
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
  if (!vttFile) return [];

  const content = await readFile(path.join(destDir, vttFile), "utf8");
  const segments = parseSubtitles(content);
  // Clean up the downloaded subtitle artifacts.
  for (const name of entries) {
    if (name.startsWith("subs") && name.endsWith(".vtt")) {
      await rm(path.join(destDir, name), { force: true }).catch(() => undefined);
    }
  }
  return segments;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export type SourceCaptionsResult = {
  segments: CaptionSegment[];
  /** Where the captions came from: the platform's subtitles or local Whisper. */
  source: "platform" | "local";
};

/**
 * Captions for a URL source, guaranteed a real attempt at every path:
 * platform captions first (fast, word-timed on YouTube), then local Whisper
 * transcription of the audio track as a fallback so a source without platform
 * captions still gets automatic captions instead of an error.
 *
 * `audioPath` lets the pipeline reuse audio it already downloaded; when the
 * file is missing (e.g. the Regenerate button long after the job ran), the
 * audio is re-downloaded.
 *
 * Throws only when BOTH paths fail — e.g. the source is unreachable and the
 * audio can't be fetched, or Whisper finds no speech.
 */
export async function fetchSourceCaptions(
  url: string,
  destDir: string,
  audioPath?: string
): Promise<SourceCaptionsResult> {
  let platformError: unknown;
  try {
    const platform = await fetchAutoCaptions(url, destDir);
    if (platform.length > 0) return { segments: platform, source: "platform" };
  } catch (error) {
    platformError = error;
  }

  // No platform captions — transcribe the audio ourselves, exactly like
  // uploaded files do.
  try {
    let audio = audioPath;
    if (!audio || !(await fileExists(audio))) {
      audio = await downloadAudio(url, destDir);
    }
    const segments = await transcribeMedia(audio, destDir);
    return { segments, source: "local" };
  } catch (error) {
    const local = error instanceof Error ? error.message : String(error);
    const platform =
      platformError instanceof Error ? ` (platform captions also failed: ${platformError.message.slice(0, 160)})` : "";
    throw new Error(`${local}${platform}`);
  }
}
