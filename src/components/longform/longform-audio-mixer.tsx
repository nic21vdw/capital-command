"use client";

import { useEffect, useRef } from "react";
import type { LongformAudioClip } from "@/lib/longform/types";

// Hidden audio mixer that makes the timeline's placed audio clips actually
// play during preview. The export bakes these clips in with ffmpeg; here we
// mirror that live by driving one <audio> element per clip off the video
// playhead. Each clip owns a source-timeline window [start, start+duration];
// while the playhead sits inside it, the clip's library track plays (looping
// to fill the window) at its mix level. A rAF loop reads the video's real
// currentTime so audio stays glued to the frame through seeks and the jump-cut
// skips, rather than the throttled React `time` state.

export function LongformAudioMixer({
  clips,
  masterVolume,
  muted,
  videoRef
}: {
  /** Placed audio clips to mix under the preview (empty disables the mixer). */
  clips: LongformAudioClip[];
  /** Master gain applied to the whole mix, mirroring the export. */
  masterVolume: number;
  /** When true, the timeline audio is silenced along with the video. */
  muted: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  // One <audio> element per clip id, registered via ref callbacks.
  const elementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const clipsRef = useRef(clips);
  const masterRef = useRef(masterVolume);
  const mutedRef = useRef(muted);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  useEffect(() => {
    masterRef.current = masterVolume;
  }, [masterVolume]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Sync loop: for each clip, play its element while the playhead is inside the
  // clip window and the video is playing, keeping the offset locked to
  // (playhead − clip.start). The track loops to fill windows longer than it,
  // and a drift resync snaps the audio back after any seek or cut-skip.
  useEffect(() => {
    // The map identity is stable across renders (only its contents change), so
    // capturing it here is safe to reuse in the cleanup below.
    const elements = elementsRef.current;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const t = video.currentTime;
        const isPlaying = !video.paused && !video.ended;
        for (const clip of clipsRef.current) {
          const el = elements.get(clip.id);
          if (!el) continue;
          el.volume = Math.min(1, Math.max(0, clip.volume * masterRef.current));
          const within = t >= clip.start && t < clip.start + clip.duration;
          if (isPlaying && within && !mutedRef.current) {
            const trackDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
            const raw = Math.max(0, t - clip.start);
            const offset = trackDur > 0 ? raw % trackDur : raw;
            if (el.paused) {
              el.currentTime = offset;
              void el.play().catch(() => undefined);
            } else if (Math.abs(el.currentTime - offset) > 0.3) {
              // Resync after a seek or a jump-cut skip moved the playhead.
              el.currentTime = offset;
            }
          } else if (!el.paused) {
            el.pause();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of elements.values()) el.pause();
    };
  }, [videoRef]);

  return (
    <div aria-hidden className="hidden">
      {clips.map((clip) => (
        <audio
          key={clip.id}
          ref={(el) => {
            if (el) elementsRef.current.set(clip.id, el);
            else elementsRef.current.delete(clip.id);
          }}
          src={`/api/longform/music/${clip.trackId}`}
          preload="auto"
          loop
        />
      ))}
    </div>
  );
}
