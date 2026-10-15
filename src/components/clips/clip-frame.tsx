"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  centerBlurCoverScale,
  clampCenterBlurZoom,
  DEFAULT_CENTER_BLUR_ZOOM
} from "@/lib/clipping/centerBlur";
import { cn } from "@/lib/utils";
import { followPreviewPlayback, previewNeedsFill } from "@/lib/clipping/previewPlayback";

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
 * on its own only while it is visible and needed. A finished render already
 * covering the frame uses a single video decoder; idle fills stay unloaded.
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
  const needsFill = previewNeedsFill(videoAspect, FRAME_ASPECT[aspect], zoom);
  // A new file is a new shape: forget the old one during render (an effect that
  // calls setState is rejected by the build) so it can't crop the next poster.
  const [lastSrc, setLastSrc] = useState(src);
  if (lastSrc !== src) {
    setLastSrc(src);
    setVideoAspect(null);
  }

  // The foreground stays mounted even before a card has a file, so the node
  // callers drive remains stable while its optional fill mounts or unmounts.
  useImperativeHandle(ref, () => fgRef.current as HTMLVideoElement, []);

  // Wait for metadata before assigning the fill a source. Finished renders
  // already cover the frame, so they never start a second video decoder.
  useEffect(() => {
    const fg = fgRef.current;
    const bg = bgRef.current;
    if (!fg || !bg || videoAspect === null || !needsFill) return;
    return followPreviewPlayback(fg, bg, document);
  }, [src, needsFill, videoAspect]);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-black",
        aspect === "16/9" ? "aspect-video" : "aspect-[9/16]",
        className
      )}
    >
      {/* The unloaded poster still fills unknown footage before metadata arrives. */}
      {needsFill ? (
        <video
          key={src}
          ref={bgRef}
          src={videoAspect === null ? undefined : src}
          poster={poster}
          preload="none"
          muted
          loop
          playsInline
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover blur-2xl brightness-[0.8]"
        />
      ) : null}
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
