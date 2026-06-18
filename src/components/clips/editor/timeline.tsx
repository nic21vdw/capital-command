"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { VideoClip, VideoSource } from "@/types/domain";
import { cn } from "@/lib/utils";
import { clipDuration, computeSegments, formatTimecode } from "./presets";

function niceTickInterval(pxPerSecond: number): number {
  const targetPx = 90;
  const seconds = targetPx / pxPerSecond;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => s >= seconds) ?? 3600;
}

function ClipWaveform({ width, height, peaks }: { width: number; height: number; peaks: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (peaks.length === 0) return;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    const mid = height / 2;
    const cols = Math.max(1, Math.floor(width));
    for (let x = 0; x < cols; x += 2) {
      const idx = Math.floor((x / cols) * peaks.length);
      const p = peaks[idx] ?? 0;
      const h = Math.max(1, p * (height - 4));
      ctx.fillRect(x, mid - h / 2, 1.4, h);
    }
  }, [width, height, peaks]);
  return <canvas ref={ref} style={{ width, height }} className="block" />;
}

type DragState =
  | { type: "scrub" }
  | { type: "trim-start"; clipId: string }
  | { type: "trim-end"; clipId: string }
  | { type: "move"; clipId: string; index: number; startX: number; offset: number; moved: boolean };

export function Timeline({
  clips,
  source,
  currentTime,
  selectedClipId,
  pxPerSecond,
  waveform,
  onScrub,
  onSelect,
  onTrimLive,
  onTrimCommit,
  onReorder
}: {
  clips: VideoClip[];
  source: VideoSource | null;
  currentTime: number;
  selectedClipId: string | null;
  pxPerSecond: number;
  waveform: number[];
  onScrub: (t: number) => void;
  onSelect: (clipId: string) => void;
  onTrimLive: (clipId: string, edge: "start" | "end", sourceTime: number) => void;
  onTrimCommit: () => void;
  onReorder: (from: number, to: number) => void;
}) {
  const segments = useMemo(() => computeSegments(clips), [clips]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const totalWidth = Math.max(320, segments.total * pxPerSecond + 24);
  const tickInterval = niceTickInterval(pxPerSecond);
  const ticks: number[] = [];
  for (let t = 0; t <= segments.total + tickInterval; t += tickInterval) ticks.push(t);

  const sourceDuration = source?.durationSec || 0;

  const posToTime = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    return Math.max(0, Math.min(x / pxPerSecond, segments.total));
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.type === "scrub") {
        onScrub(posToTime(e.clientX));
      } else if (drag.type === "trim-start" || drag.type === "trim-end") {
        const clip = clips.find((c) => c.id === drag.clipId);
        if (!clip) return;
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left + el.scrollLeft;
        const timelinePos = Math.max(0, x / pxPerSecond);
        const index = clips.indexOf(clip);
        const clipStartTl = segments.starts[index];
        const localTl = Math.max(0, timelinePos - clipStartTl);
        const sourceTime = clip.sourceStart + localTl * clip.speed;
        if (drag.type === "trim-start") {
          onTrimLive(clip.id, "start", Math.max(0, Math.min(sourceTime, clip.sourceEnd - 0.1)));
        } else {
          const cap = sourceDuration > 0 ? sourceDuration : clip.sourceEnd + 3600;
          onTrimLive(clip.id, "end", Math.max(clip.sourceStart + 0.1, Math.min(sourceTime, cap)));
        }
      } else if (drag.type === "move") {
        const dx = e.clientX - drag.startX;
        if (Math.abs(dx) > 5) drag.moved = true;
        setDragOffset(dx);
      }
    };
    const up = (e: PointerEvent) => {
      if (drag.type === "trim-start" || drag.type === "trim-end") {
        onTrimCommit();
      } else if (drag.type === "move") {
        if (drag.moved) {
          const draggedLeft = segments.starts[drag.index] * pxPerSecond + (e.clientX - drag.startX);
          const draggedCenter = draggedLeft + (clipDuration(clips[drag.index]) * pxPerSecond) / 2;
          let target = 0;
          clips.forEach((c, i) => {
            if (i === drag.index) return;
            const center = (segments.starts[i] + clipDuration(c) / 2) * pxPerSecond;
            if (center < draggedCenter) target += 1;
          });
          if (target !== drag.index) onReorder(drag.index, target);
        } else {
          onSelect(drag.clipId);
        }
        setDragOffset(0);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, clips, segments, pxPerSecond, sourceDuration]);

  const playheadX = currentTime * pxPerSecond;

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
      <div ref={trackRef} className="relative select-none" style={{ width: totalWidth }}>
        {/* Ruler */}
        <div
          className="relative h-6 border-b border-[var(--border)] bg-black/20"
          onPointerDown={(e) => {
            e.preventDefault();
            onScrub(posToTime(e.clientX));
            setDrag({ type: "scrub" });
          }}
        >
          {ticks.map((t) => (
            <div key={t} className="absolute top-0 h-full" style={{ left: t * pxPerSecond }}>
              <div className="h-2 w-px bg-white/20" />
              <span className="absolute left-1 top-1.5 text-[10px] text-[var(--muted-foreground)]">
                {formatTimecode(t)}
              </span>
            </div>
          ))}
        </div>

        {/* Clips */}
        <div
          className="relative h-24 bg-black/10"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              onScrub(posToTime(e.clientX));
              setDrag({ type: "scrub" });
            }
          }}
        >
          {clips.map((clip, index) => {
            const left = segments.starts[index] * pxPerSecond;
            const width = Math.max(8, clipDuration(clip) * pxPerSecond);
            const selected = clip.id === selectedClipId;
            const isDragging = drag?.type === "move" && drag.clipId === clip.id;
            const peakSlice =
              sourceDuration > 0 && waveform.length > 0
                ? waveform.slice(
                    Math.floor((clip.sourceStart / sourceDuration) * waveform.length),
                    Math.max(
                      Math.floor((clip.sourceStart / sourceDuration) * waveform.length) + 1,
                      Math.floor((clip.sourceEnd / sourceDuration) * waveform.length)
                    )
                  )
                : [];
            return (
              <div
                key={clip.id}
                className={cn(
                  "absolute top-2 h-20 overflow-hidden rounded-md border bg-[var(--accent)]/15",
                  selected ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-white/15",
                  isDragging && "z-20 opacity-80"
                )}
                style={{ left, width, transform: isDragging ? `translateX(${dragOffset}px)` : undefined }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(clip.id);
                  setDrag({ type: "move", clipId: clip.id, index, startX: e.clientX, offset: left, moved: false });
                }}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-2 py-1">
                  <span className="truncate text-[11px] font-medium text-white">#{index + 1}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {formatTimecode(clipDuration(clip), true)}
                  </span>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-1 top-6">
                  <ClipWaveform width={Math.max(1, width)} height={56} peaks={peakSlice} />
                </div>

                {selected && (
                  <>
                    <div
                      className="absolute left-0 top-0 z-10 flex h-full w-2.5 cursor-ew-resize items-center justify-center bg-[var(--accent)]/80"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDrag({ type: "trim-start", clipId: clip.id });
                      }}
                    >
                      <div className="h-6 w-0.5 rounded bg-white/90" />
                    </div>
                    <div
                      className="absolute right-0 top-0 z-10 flex h-full w-2.5 cursor-ew-resize items-center justify-center bg-[var(--accent)]/80"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDrag({ type: "trim-end", clipId: clip.id });
                      }}
                    >
                      <div className="h-6 w-0.5 rounded bg-white/90" />
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {clips.length === 0 && (
            <div className="flex h-full items-center justify-center text-xs text-[var(--muted-foreground)]">
              No clips yet — add the whole video or a segment to the timeline.
            </div>
          )}
        </div>

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 z-30 h-full"
          style={{ left: playheadX }}
        >
          <div className="h-full w-px bg-[var(--accent)]" />
          <div className="absolute -left-1.5 -top-0.5 h-3 w-3 rounded-full bg-[var(--accent)]" />
        </div>
      </div>
    </div>
  );
}
