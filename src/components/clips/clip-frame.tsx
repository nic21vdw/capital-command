"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  centerBlurCoverScale,
  clampCenterBlurZoom,
  DEFAULT_CENTER_BLUR_ZOOM
} from "@/lib/clipping/centerBlur";
import { cn } from "@/lib/utils";

/**
 * The center + blur composition, in the browser.
 *
 * Every clip preview in the app shows the frame `object-contain`, never
 * `object-cover`, and fills the space left over with a blurred, dimmed copy of
 * the same footage instead of black bars. That is the same composition
 * `renderCaptionedVertical` burns into the ready-to-post download file, so a
 * tile looks right whichever file happens to be backing it: the finished 9:16
 * render, the instant 16:9 preview published before the HD render finishes, or
 * the neutral master of an older job whose ready render never happened.
 *
 * The render punches the centred copy in (`DEFAULT_CENTER_BLUR_ZOOM`) so the
 * footage is bigger than its fill, giving up the extreme left and right edges
 * of a widescreen source — and the preview has to show that, or it promises a
 * shot the file does not contain. The punch-in is capped at the point the
 * footage covers the frame, which is what stops a file that is ALREADY the
 * shipping 9:16 shape from being zoomed a second time.
 *
 * Black letterbox bars are the bug this component exists to prevent — if you
 * add a new surface that shows a clip, render it through here.
 *
 * The ref is forwarded to the foreground `<video>`, so callers drive playback
 * exactly as they would a plain video element; the blurred fill follows along
 * on its own (it shares the `src`, so it costs one cached response, and it
 * stays unloaded behind its poster until the clip actually plays).
 */
export type ClipFrameProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src" | "poster" | "className"> & {
  src?: string;
  poster?: string;
  /** Frame shape. Clips are 9:16; use "16/9" only for a widescreen master. */
  aspect?: "9/16" | "16/9";
  /** Classes for the frame wrapper, not the video. */
  className?: string;
  /** Overlays (badges, play icon, duration) positioned against the frame. */
  children?: React.ReactNode;
  /**
   * The centre + blur punch-in to reproduce. Capped at the point where the
   * footage covers the frame, so a file that is already the shipping shape is
   * never zoomed a second time. Pass 1 to show the plain contain fit.
   */
  zoom?: number;
};

/** Drift past this many seconds and the fill is visibly out of step; resync. */
const MAX_FILL_DRIFT = 0.3;

const FRAME_ASPECT: Record<NonNullable<ClipFrameProps["aspect"]>, number> = {
  "9/16": 9 / 16,
  "16/9": 16 / 9
};

export const ClipFrame = forwardRef<HTMLVideoElement, ClipFrameProps>(function ClipFrame(
  { src, poster, aspect = "9/16", className, children, zoom = DEFAULT_CENTER_BLUR_ZOOM, ...videoProps },
  ref
) {
  const fgRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  // Until the metadata says what shape the file is, show it un-zoomed rather
  // than guess — a wrong guess crops the poster on first paint.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const punchIn = Math.min(
    clampCenterBlurZoom(zoom),
    videoAspect ? centerBlurCoverScale(videoAspect, FRAME_ASPECT[aspect]) : 1
  );
  // A new file is a new shape: forget the old one during render (an effect that
  // calls setState is rejected by the build) so it can't crop the next poster.
  const [lastSrc, setLastSrc] = useState(src);
  if (lastSrc !== src) {
    setLastSrc(src);
    setVideoAspect(null);
  }

  // Both <video> elements are always mounted (a card can mount before its clip
  // has any file at all), so the node the caller drives is stable from the
  // first render and this never has to re-resolve.
  useImperativeHandle(ref, () => fgRef.current as HTMLVideoElement, []);

  // Keep the blurred fill locked to the clip. Same file, so it only needs
  // nudging when playback starts or stops, or when a seek/buffering stall
  // pulls the two apart.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const resync = () => {
      const bg = bgRef.current;
      if (!bg || Math.abs(bg.currentTime - fg.currentTime) <= MAX_FILL_DRIFT) return;
      try {
        bg.currentTime = fg.currentTime;
      } catch {
        // Seeking before the media is seekable throws; the next tick retries.
      }
    };
    const onPlay = () => {
      const bg = bgRef.current;
      if (!bg) return;
      // The fill stays unloaded until the clip is actually watched, so a grid
      // of idle cards costs nothing beyond their posters.
      bg.preload = "auto";
      resync();
      void bg.play().catch(() => undefined);
    };
    const onPause = () => {
      bgRef.current?.pause();
      resync();
    };

    fg.addEventListener("play", onPlay);
    fg.addEventListener("pause", onPause);
    fg.addEventListener("seeked", resync);
    fg.addEventListener("timeupdate", resync);
    return () => {
      fg.removeEventListener("play", onPlay);
      fg.removeEventListener("pause", onPause);
      fg.removeEventListener("seeked", resync);
      fg.removeEventListener("timeupdate", resync);
    };
  }, []);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-black",
        aspect === "16/9" ? "aspect-video" : "aspect-[9/16]",
        className
      )}
    >
      {/* blurred fill — scaled past the edges so the blur has no seam */}
      <video
        ref={bgRef}
        src={src}
        poster={poster}
        preload="none"
        muted
        loop
        playsInline
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover blur-2xl brightness-[0.8]"
      />
      {/* the clip itself, punched in exactly as far as the render punches it */}
      <video
        ref={fgRef}
        src={src}
        poster={poster}
        muted
        playsInline
        {...videoProps}
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          if (el.videoWidth > 0 && el.videoHeight > 0) setVideoAspect(el.videoWidth / el.videoHeight);
          videoProps.onLoadedMetadata?.(event);
        }}
        style={{ ...videoProps.style, transform: punchIn > 1 ? `scale(${punchIn})` : undefined }}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {children}
    </div>
  );
});
