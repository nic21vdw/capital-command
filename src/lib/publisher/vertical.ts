import { stat } from "node:fs/promises";
import path from "node:path";
import { hasAudioStream, probeVideoStream } from "@/lib/clipping/ffmpeg";
import { renderVertical } from "@/lib/clipping/render";
import type { PlatformId } from "@/lib/publisher/types";

/**
 * YouTube decides Short vs long-form entirely from the uploaded file: a video
 * becomes a Short only when it is square or taller than wide AND at most
 * three minutes long. There is no API flag and #shorts hashtags have no
 * effect — a landscape upload always lands as a long-form video. The same
 * vertical format is what Reels and TikTok expect, so every SHORT-FORM post
 * passes through this gate before it is queued, hosted, or uploaded.
 *
 * A long-form post is not a Short and is not measured against one. The pipeline
 * books a run's long-form edit and its ten-minute topic segments as ordinary
 * full-length YouTube videos, so they keep their own shape and their own length
 * — applying the Shorts rules to them refused every one of them, which is
 * exactly what this format flag exists to prevent.
 *
 * It is still PROBED, though. Exempting long-form from the Shorts rules used to
 * exempt it from looking at the file at all, so a long-form booking was the one
 * route into the queue that never asked whether the path even held a video. A
 * folder, a zero-byte render or a stray .txt sailed through and only failed at
 * its slot, days later, with nothing on screen until then.
 */

export const SHORTS_MAX_SECONDS = 180;

/** What the file is being posted AS — not what it looks like. */
export type PostFormat = "short" | "long";

export type PreparedMedia = {
  /** Absolute path of the file to post — the source itself, or a derived vertical render. */
  path: string;
  /** True when a vertical render was substituted for a landscape source. */
  converted: boolean;
};

/**
 * The one check a long-form post still owes: ffmpeg can find a video stream in
 * the file. No shape rule, no length rule — those are the Shorts gate below and
 * were deliberately lifted off long-form. This only refuses what could never
 * upload at all, and it names the file, because the caller only knows the path
 * it was handed.
 */
async function assertPlayableVideo(absolutePath: string): Promise<void> {
  try {
    await probeVideoStream(absolutePath);
  } catch {
    throw new Error(
      `${path.basename(absolutePath)} has no video stream ffmpeg can read — it is not a video file, so it cannot be posted.`
    );
  }
}

/** Sibling path the derived vertical render is cached at. */
export function verticalRenderPath(absolutePath: string): string {
  const parsed = path.parse(absolutePath);
  return path.join(parsed.dir, `${parsed.name}-vertical.mp4`);
}

/**
 * Returns the file to actually post: the source when it is already square or
 * vertical, otherwise a 9:16 re-render (source centered over a blurred fill
 * of itself) cached next to the source and reused across platforms. Throws
 * when a SHORT-FORM YouTube post can't possibly be a Short (longer than three
 * minutes) — the boundary is strict, so even 180.0s files classify as
 * long-form. A `"long"` post is left exactly as it is: neither reshaped nor
 * length-checked — but it is still confirmed to be a video, because a path that
 * holds no video stream is a post that cannot happen and should say so now.
 */
export async function prepareVerticalMedia(
  absolutePath: string,
  platforms: PlatformId[],
  format: PostFormat = "short"
): Promise<PreparedMedia> {
  if (format === "long") {
    await assertPlayableVideo(absolutePath);
    return { path: absolutePath, converted: false };
  }

  const info = await probeVideoStream(absolutePath);
  if (platforms.includes("youtube") && info.durationSec !== null && info.durationSec > SHORTS_MAX_SECONDS - 1) {
    throw new Error(
      `This clip is ${Math.round(info.durationSec)}s long — YouTube only classifies videos up to 3 minutes as Shorts, and anything longer uploads as a long-form video. Trim the clip below 3 minutes and try again.`
    );
  }
  if (info.height >= info.width) return { path: absolutePath, converted: false };

  const target = verticalRenderPath(absolutePath);
  const [sourceInfo, targetInfo] = await Promise.all([stat(absolutePath), stat(target).catch(() => null)]);
  // Re-render only when the cached vertical copy is missing or stale.
  if (!targetInfo || targetInfo.size === 0 || targetInfo.mtimeMs < sourceInfo.mtimeMs) {
    await renderVertical(absolutePath, target, await hasAudioStream(absolutePath));
  }
  return { path: target, converted: true };
}
