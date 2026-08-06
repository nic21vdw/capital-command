import { probeVideoStream } from "@/lib/clipping/ffmpeg";
import { planFraming, type ClipFraming, type FramingTarget } from "@/lib/clipping/framing";
import { detectSubjectTrack } from "@/lib/clipping/subject";
import type { ClipFramingSpec } from "@/lib/clipping/render";

export const DOWNLOAD_FRAME_W = 1080;
export const DOWNLOAD_FRAME_H = 1920;

/**
 * Watches a cut section and decides how to frame it vertically. Never throws:
 * a probe or detection failure returns null and the caller composes the clip
 * the neutral way, exactly as it did before auto-framing existed.
 */
export async function planClipFraming(
  inputPath: string,
  { targetW = DOWNLOAD_FRAME_W, targetH = DOWNLOAD_FRAME_H }: { targetW?: number; targetH?: number } = {}
): Promise<ClipFramingSpec | null> {
  try {
    const stream = await probeVideoStream(inputPath);
    const target: FramingTarget = {
      sourceW: stream.width,
      sourceH: stream.height,
      targetW,
      targetH
    };
    const track = await detectSubjectTrack(inputPath);
    return { framing: planFraming(track, target), target };
  } catch {
    return null;
  }
}

/** One-line summary of a framing decision, for job notices and the clip card. */
export function framingLabel(framing: ClipFraming): string {
  if (framing.mode === "subject-fill") return "Framed on speaker";
  if (framing.mode === "speaker-stack") return "Camera lead";
  return "Centered + blur";
}
