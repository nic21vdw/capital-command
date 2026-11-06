import { centerBlurCoverScale, clampCenterBlurZoom } from "./centerBlur";

/** Unknown footage keeps its poster fill; a covered frame needs no second decoder. */
export function previewNeedsFill(sourceAspect: number | null, frameAspect: number, zoom: number): boolean {
  return sourceAspect === null || clampCenterBlurZoom(zoom) + 0.000001 < centerBlurCoverScale(sourceAspect, frameAspect);
}

type PreviewVideo = Pick<HTMLVideoElement,
  "currentTime" | "paused" | "ended" | "seeking" | "readyState" | "playbackRate" |
  "preload" | "play" | "pause" | "load" | "addEventListener" | "removeEventListener"
>;

type PreviewVisibility = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

/**
 * Follow the visible player's clock without a timer or a second playback loop.
 * A hidden, paused, ended or buffering foreground never leaves the fill decoding.
 */
export function followPreviewPlayback(
  foreground: PreviewVideo,
  fill: PreviewVideo,
  visibility: PreviewVisibility
): () => void {
  let active = true;
  let waiting = false;
  let playPending = false;
  let seekRequested = false;
  let seekLoadStarted = false;

  const sync = () => {
    if (!active) return;
    const shouldPlay = !visibility.hidden && !waiting && !foreground.paused &&
      !foreground.ended && !foreground.seeking && foreground.readyState >= 3;
    fill.playbackRate = foreground.playbackRate;
    // Ordinary idle time updates stay unloaded; an explicit scrub must also
    // update the paused fill, including when it has not loaded metadata yet.
    if (seekRequested || shouldPlay || fill.readyState > 0) {
      if (seekRequested || Math.abs(fill.currentTime - foreground.currentTime) > 0.3) {
        try {
          fill.currentTime = foreground.currentTime;
          if (fill.readyState > 0) seekRequested = false;
        } catch {
          // The fill's loadedmetadata event retries once the resource is seekable.
        }
      }
    }
    if (!shouldPlay) {
      fill.pause();
      return;
    }
    fill.preload = "auto";
    if (!fill.paused || playPending) return;
    playPending = true;
    void fill.play().catch(() => undefined).finally(() => {
      playPending = false;
      // A pending play can settle after pause, hide or effect cleanup.
      if (!active || visibility.hidden || foreground.paused || foreground.ended ||
          foreground.seeking || waiting) fill.pause();
    });
  };
  const onWaiting = () => { waiting = true; sync(); };
  const onPlaying = () => { waiting = false; sync(); };
  const onSeeked = () => {
    seekRequested = true;
    fill.preload = "auto";
    if (fill.readyState === 0 && !seekLoadStarted) {
      seekLoadStarted = true;
      fill.load();
    }
    sync();
  };
  const events = ["play", "pause", "ended", "seeking", "timeupdate", "ratechange"] as const;
  for (const event of events) foreground.addEventListener(event, sync);
  foreground.addEventListener("seeked", onSeeked);
  foreground.addEventListener("waiting", onWaiting);
  foreground.addEventListener("playing", onPlaying);
  fill.addEventListener("loadedmetadata", sync);
  visibility.addEventListener("visibilitychange", sync);
  sync();

  return () => {
    active = false;
    for (const event of events) foreground.removeEventListener(event, sync);
    foreground.removeEventListener("seeked", onSeeked);
    foreground.removeEventListener("waiting", onWaiting);
    foreground.removeEventListener("playing", onPlaying);
    fill.removeEventListener("loadedmetadata", sync);
    visibility.removeEventListener("visibilitychange", sync);
    fill.pause();
  };
}
