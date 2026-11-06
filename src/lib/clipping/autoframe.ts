import { detectFaceFrames, pickSpeakerFace, planFaceFraming } from "@/lib/clipping/face";
import { probeVideoStream } from "@/lib/clipping/ffmpeg";
import { planFraming, type FramingTarget } from "@/lib/clipping/framing";
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
    const faces = await detectFaceFrames(inputPath);
    const byFace = faces ? planFaceFraming(pickSpeakerFace(faces), target) : null;
    if (byFace) return { framing: byFace, target };
    const track = await detectSubjectTrack(inputPath);
    return { framing: planFraming(track, target), target };
  } catch {
    return null;
  }
}
