import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoClip } from "@/types/domain";
import { computeSegments, fadeMultiplier, locateTime } from "./presets";

/**
 * Drives a single <video> element through the project's clips in order, so the
 * timeline plays as one continuous output without ever modifying the source.
 * Each clip maps a source time-range to a slice of the timeline; per-clip speed,
 * volume, mute and fades are applied live on the shared element.
 */
export function useTimelinePlayer(videoRef: React.RefObject<HTMLVideoElement | null>, clips: VideoClip[]) {
  const segments = useMemo(() => computeSegments(clips), [clips]);
  const duration = segments.total;

  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [ready, setReady] = useState(false);

  const clipsRef = useRef(clips);
  const segmentsRef = useRef(segments);
  useEffect(() => {
    clipsRef.current = clips;
    segmentsRef.current = segments;
  }, [clips, segments]);
  const idxRef = useRef(0);
  const playingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const applyClipConfig = useCallback(
    (clip: VideoClip, sourceTime: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = clip.speed;
      video.muted = clip.muted;
      video.volume = Math.min(1, clip.volume) * fadeMultiplier(clip, sourceTime);
    },
    [videoRef]
  );

  const setActive = useCallback(
    (index: number, sourceTime: number) => {
      const video = videoRef.current;
      if (!video) return;
      idxRef.current = index;
      setActiveIndex(index);
      const clip = clipsRef.current[index];
      if (!clip) return;
      applyClipConfig(clip, sourceTime);
      if (Math.abs(video.currentTime - sourceTime) > 0.05) {
        video.currentTime = sourceTime;
      }
    },
    [applyClipConfig, videoRef]
  );

  const seek = useCallback(
    (t: number) => {
      const located = locateTime(clipsRef.current, segmentsRef.current, t);
      if (!located) {
        setCurrentTime(0);
        return;
      }
      setActive(located.index, located.sourceTime);
      setCurrentTime(Math.max(0, Math.min(t, segmentsRef.current.total)));
    },
    [setActive]
  );

  // The rAF loop reads from `tickRef` so the callback can reschedule itself
  // without referencing its own binding before declaration.
  const tickRef = useRef<() => void>(() => {});
  const schedule = useCallback(() => {
    rafRef.current = requestAnimationFrame(() => tickRef.current());
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !playingRef.current) return;
    const clips2 = clipsRef.current;
    const seg = segmentsRef.current;
    const index = idxRef.current;
    const clip = clips2[index];
    if (!clip) {
      schedule();
      return;
    }
    const vt = video.currentTime;
    if (vt >= clip.sourceEnd - 0.03) {
      if (index + 1 < clips2.length) {
        const next = clips2[index + 1];
        setActive(index + 1, next.sourceStart);
      } else {
        playingRef.current = false;
        setPlaying(false);
        video.pause();
        setCurrentTime(seg.total);
        return;
      }
    } else {
      const tl = seg.starts[index] + (vt - clip.sourceStart) / clip.speed;
      setCurrentTime(tl);
      video.volume = Math.min(1, clip.volume) * fadeMultiplier(clip, vt);
    }
    schedule();
  }, [schedule, setActive, videoRef]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video || clipsRef.current.length === 0) return;
    if (currentTime >= segmentsRef.current.total - 0.05) {
      seek(0);
    } else {
      // Re-assert the current clip's source position before resuming.
      const located = locateTime(clipsRef.current, segmentsRef.current, currentTime);
      if (located) setActive(located.index, located.sourceTime);
    }
    playingRef.current = true;
    setPlaying(true);
    void video.play().catch(() => undefined);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    schedule();
  }, [currentTime, schedule, seek, setActive, videoRef]);

  const pause = useCallback(() => {
    const video = videoRef.current;
    playingRef.current = false;
    setPlaying(false);
    if (video) video.pause();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, [videoRef]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const stepFrame = useCallback(
    (deltaSeconds: number) => {
      pause();
      seek(Math.max(0, Math.min(currentTime + deltaSeconds, duration)));
    },
    [currentTime, duration, pause, seek]
  );

  // When the source element is ready, snap to time 0.
  const handleLoaded = useCallback(() => {
    setReady(true);
    seek(0);
  }, [seek]);

  // Keep the playhead valid if clips change while paused (trim/delete/reorder).
  useEffect(() => {
    if (playingRef.current) return;
    const seg = segmentsRef.current;
    if (currentTime > seg.total) {
      seek(seg.total);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    currentTime,
    duration,
    playing,
    activeIndex,
    ready,
    play,
    pause,
    toggle,
    seek,
    stepFrame,
    handleLoaded
  };
}
