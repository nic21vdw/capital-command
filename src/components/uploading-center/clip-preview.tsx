"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { ClipFrame } from "@/components/clips/clip-frame";
import { Modal } from "@/components/ui/modal";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Clip thumbnail with in-place previews: hovering swaps the poster for a
 * muted, looping mini preview of the render; clicking opens the full clip
 * (with sound and controls) in a modal, so you never leave the page.
 *
 * `startSec` is the dead air the clip opens on: both previews jump straight to
 * it (and the looping mini preview re-skips it on every loop) so the viewer
 * lands on the first spoken word instead of watching the clip start on silence.
 */
export function ClipPreview({
  thumbnailUrl,
  previewUrl,
  headline,
  durationSec,
  startSec = 0
}: {
  thumbnailUrl: string;
  previewUrl: string;
  headline: string;
  durationSec: number;
  startSec?: number;
}) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Skip the opening pause. Guard on currentTime so a manual scrub back to the
  // pause (or the natural loop restart) isn't yanked forward mid-playback.
  const skipLeadingPause = (video: HTMLVideoElement) => {
    if (startSec > 0 && video.currentTime < startSec) {
      try {
        video.currentTime = startSec;
      } catch {
        // Seeking before the media is seekable throws on some browsers; the
        // loadedmetadata handler will land the seek once it is.
      }
    }
  };

  const startPreview = () => {
    const video = videoRef.current;
    if (!video) return;
    // The tile mounts unloaded behind its poster; only fetch the mp4 once
    // someone shows interest in it.
    video.preload = "auto";
    skipLeadingPause(video);
    void video.play().catch(() => undefined);
  };
  const stopPreview = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = startSec;
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Preview clip: ${headline}`}
        onClick={() => setOpen(true)}
        onMouseEnter={startPreview}
        onMouseLeave={stopPreview}
        onFocus={startPreview}
        onBlur={stopPreview}
        className="group relative block w-full cursor-pointer overflow-hidden rounded-lg border border-[var(--border)] bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <ClipFrame
          ref={videoRef}
          src={previewUrl}
          poster={thumbnailUrl}
          preload="none"
          onLoadedMetadata={(e) => skipLeadingPause(e.currentTarget)}
          // Manual loop (instead of the `loop` attribute) so each pass also
          // starts past the opening pause rather than replaying the silence.
          onEnded={(e) => {
            const video = e.currentTarget;
            video.currentTime = startSec;
            void video.play().catch(() => undefined);
          }}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
          <Play
            className="h-6 w-6 text-white opacity-0 drop-shadow transition group-hover:opacity-90"
            fill="currentColor"
          />
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {formatDuration(durationSec)}
        </span>
      </button>
      <Modal open={open} title={headline} description="Full preview" onClose={() => setOpen(false)}>
        <div className="flex justify-center">
          {open ? (
            <video
              src={previewUrl}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={(e) => skipLeadingPause(e.currentTarget)}
              className="max-h-[70vh] rounded-xl border border-[var(--border)] bg-black"
            />
          ) : null}
        </div>
      </Modal>
    </>
  );
}
