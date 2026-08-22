/**
 * Mastering and encode settings for short-form renders.
 *
 * Every ready-to-post short used to be muxed with whatever the stream
 * recorded: no gain staging, no loudness target, AAC 128k at the source
 * sample rate. On a feed where the clip before and after it are mastered to
 * roughly -14 LUFS, that reads as quiet and thin — the single loudest
 * amateur tell a short has, and one a viewer reacts to before the first word
 * lands. Long-form already normalized its final mix (`longform/render.ts`);
 * this is the same treatment for the short-form paths, plus the compression
 * that keeps a quiet aside audible next to a loud one inside the same clip.
 *
 * Leaf module: no imports, pure strings, tested. Nothing here decides WHICH
 * files get mastered — the render functions do.
 */

/** Integrated loudness every short is normalized to, matching the platforms' own target. */
export const SHORTS_LOUDNESS_LUFS = -14;
/** True-peak ceiling, low enough to survive the platform's own re-encode without clipping. */
export const SHORTS_TRUE_PEAK_DB = -1.5;
/** Loudness range: tighter than long-form, because a short has no room to breathe. */
export const SHORTS_LOUDNESS_RANGE = 9;

/**
 * The audio chain applied to a short's final mix, in order:
 *
 * - `highpass` clears desk rumble and mic handling under 70 Hz, which on a
 *   phone speaker is only wasted headroom.
 * - `acompressor` at a gentle 3:1 above roughly -18 dBFS evens out the gap
 *   between a leaning-back aside and a leaning-in point.
 * - `loudnorm` puts the result on the platform target so the clip is as loud
 *   as everything around it in the feed.
 * - `alimiter` is the safety catch under loudnorm's true-peak ceiling.
 * - `aresample` lands on 48 kHz, which is what the encoders below expect.
 */
export function shortsAudioFilter(): string {
  return [
    "highpass=f=70",
    "acompressor=threshold=0.125:ratio=3:attack=10:release=200",
    `loudnorm=I=${SHORTS_LOUDNESS_LUFS}:TP=${SHORTS_TRUE_PEAK_DB}:LRA=${SHORTS_LOUDNESS_RANGE}`,
    "alimiter=limit=0.891",
    "aresample=48000"
  ].join(",");
}

/**
 * Appends the mastering chain to a filtergraph label that already carries a
 * finished mix, producing `[<outLabel>]`. Used by graphs that mix music and
 * effects before mastering (the Clip Editor export).
 */
export function shortsMasteringChain(inLabel: string, outLabel: string): string {
  return `[${inLabel}]${shortsAudioFilter()}[${outLabel}]`;
}

/** Encoder settings for a short's audio: stereo 48 kHz AAC at a bitrate the platforms won't audibly re-crush. */
export function shortsAudioArgs(): string[] {
  return ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];
}

/**
 * Encoder settings for a short's video. A 1080x1920 frame carrying burned
 * captions, a title and (usually) an editor screenshare is exactly the
 * content x264 spends its bits worst on at CRF 23 `veryfast`: text edges go
 * soft, and the platform then re-encodes that softness rather than the
 * original. `fast` at CRF 20 is roughly half again the encode time for a
 * visibly cleaner master, which is the right trade on a file that is
 * rendered once and re-encoded by four platforms.
 */
export function shortsVideoArgs(): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p"
  ];
}
