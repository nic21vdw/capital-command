/**
 * Shared encode and scale settings for every master that ships.
 *
 * Shorts used to pull a 720p section and stretch it, then both the 9:16
 * render and the long-form body encoded with a fast preset that spends its
 * bits worst on burned captions and screenshare text. The platform then
 * re-encodes that softness. One place now owns the settings both paths
 * read: lanczos on every quality-critical scale, x264 medium / CRF 17,
 * AAC 320k.
 *
 * Leaf module: no imports, pure strings, tested.
 */

export const MASTER_PRESET = "medium";
export const MASTER_CRF = 17;
export const MASTER_AUDIO_BITRATE = "320k";
export const SCALE_FLAGS = "lanczos+accurate_rnd+full_chroma_int";

export const CLIP_SECTION_FORMAT =
  "bv*[height<=1080]+ba/b[height<=1080][ext=mp4]/b[height<=1080]/b";
export const FULL_VIDEO_FORMAT =
  "bv*[height<=1440]+ba/b[height<=1440]/bv*[height<=1080]+ba/b";

export function evenPixels(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(2, Math.round(value / 2) * 2);
}

export function scaleFilter(w: number | string, h: number | string, extra: string[] = []): string {
  return [`scale=${w}:${h}`, ...extra, `flags=${SCALE_FLAGS}`].join(":");
}

export function coverScale(w: number | string, h: number | string): string {
  return scaleFilter(w, h, ["force_original_aspect_ratio=increase"]);
}

export function containScale(w: number | string, h: number | string): string {
  return scaleFilter(w, h, ["force_original_aspect_ratio=decrease"]);
}

export function masterVideoArgs(crf: number = MASTER_CRF): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    MASTER_PRESET,
    "-crf",
    String(crf),
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p"
  ];
}

export function masterAudioArgs(): string[] {
  return ["-c:a", "aac", "-b:a", MASTER_AUDIO_BITRATE, "-ar", "48000", "-ac", "2"];
}
