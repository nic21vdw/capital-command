"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { formatClock } from "@/lib/clipping/editor";
import type { LongformProject } from "@/lib/longform/types";
import { cn } from "@/lib/utils";

// The Long-Form Editor timeline: the full recording with its waveform, the
// hook region, and every planned cut. Kept footage plays; dimmed red blocks
// are the dead space the edit removes — click any block to flip it.

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

function pickTickStep(secondsPerPixel: number) {
  // A label roughly every 90px keeps the ruler readable at any zoom.
  const target = secondsPerPixel * 90;
  return TICK_STEPS.find((step) => step >= target) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

export function LongformTimeline({
  project,
  time,
  peaks,
  onSeek,
  onToggleSegment,
  onHookEndChange
}: {
  project: LongformProject;
  time: number;
  peaks: number[];
  onSeek: (t: number) => void;
  onToggleSegment: (id: string) => void;
  onHookEndChange: (end: number) => void;
}) {
  const duration = Math.max(0.1, project.durationSec);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [trackWidth, setTrackWidth] = useState(0);
  const draggingRef = useRef<"scrub" | "hook" | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setTrackWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const contentWidth = Math.max(1, Math.round(trackWidth * zoom));
  const pct = useCallback((t: number) => `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%`, [duration]);

  // Waveform: the cached 0..1 peaks drawn as a mirrored bar chart.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || contentWidth < 2) return;
    const height = 56;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(contentWidth * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, contentWidth, height);
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#a855f7";
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.55;
    const mid = height / 2;
    const bars = Math.max(1, Math.floor(contentWidth / 2));
    for (let i = 0; i < bars; i++) {
      const peakIndex = Math.min(peaks.length - 1, Math.floor((i / bars) * peaks.length));
      const peak = peaks.length > 0 ? peaks[peakIndex] : 0;
      const h = Math.max(1, peak * (height - 8));
      ctx.fillRect(i * 2, mid - h / 2, 1.4, h);
    }
    ctx.globalAlpha = 1;
  }, [peaks, contentWidth]);

  const timeFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
      return (x / rect.width) * duration;
    },
    [duration]
  );

  const beginScrub = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      draggingRef.current = "scrub";
      onSeek(timeFromPointer(event.clientX));
      const move = (e: PointerEvent) => {
        if (draggingRef.current === "scrub") onSeek(timeFromPointer(e.clientX));
      };
      const up = () => {
        draggingRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onSeek, timeFromPointer]
  );

  const beginHookDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = "hook";
      const move = (e: PointerEvent) => {
        if (draggingRef.current === "hook") {
          onHookEndChange(Math.min(15, Math.max(2, timeFromPointer(e.clientX))));
        }
      };
      const up = () => {
        draggingRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onHookEndChange, timeFromPointer]
  );

  const ticks = useMemo(() => {
    const secondsPerPixel = duration / Math.max(1, contentWidth);
    const step = pickTickStep(secondsPerPixel);
    const items: number[] = [];
    for (let t = 0; t <= duration; t += step) items.push(t);
    return items;
  }, [duration, contentWidth]);

  const cutCount = project.segments.filter((segment) => !segment.enabled).length;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">
          Timeline — click a red block to keep it, click kept footage to cut it. Drag the purple handle to resize the hook.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 text-xs text-[var(--muted-foreground)]">{cutCount} cuts</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
            aria-label="Zoom out"
            data-no-press
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
            aria-label="Zoom in"
            data-no-press
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div style={{ width: contentWidth }} className="relative select-none">
          {/* Ruler */}
          <div className="relative h-5 border-b border-[var(--border)] text-[10px] text-[var(--muted-foreground)]">
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: pct(t) }}>
                {formatClock(t)}
              </span>
            ))}
          </div>

          {/* Main track */}
          <div
            ref={trackRef}
            role="presentation"
            onPointerDown={beginScrub}
            className="relative mt-2 h-14 cursor-crosshair overflow-hidden rounded-lg bg-[var(--surface-2)]"
            data-no-press
          >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ width: contentWidth, height: 56 }} />

            {/* Segment blocks */}
            {project.segments.map((segment) => {
              const width = `${((segment.end - segment.start) / duration) * 100}%`;
              const isCut = !segment.enabled;
              return (
                <button
                  key={segment.id}
                  type="button"
                  data-no-press
                  title={`${segment.kind === "silence" ? "Dead space" : "Footage"} ${formatClock(segment.start)}–${formatClock(segment.end)} (${(segment.end - segment.start).toFixed(1)}s) — click to ${isCut ? "keep" : "cut"}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSegment(segment.id);
                  }}
                  className={cn(
                    "absolute top-0 h-full border-r border-black/20 transition-colors",
                    isCut
                      ? "bg-red-500/35 hover:bg-red-500/50 backdrop-saturate-0"
                      : segment.kind === "silence"
                        ? "bg-emerald-400/15 hover:bg-emerald-400/25"
                        : "bg-transparent hover:bg-white/10"
                  )}
                  style={{ left: pct(segment.start), width }}
                >
                  {isCut && <span className="sr-only">Cut segment</span>}
                </button>
              );
            })}

            {/* Hook region */}
            {project.hook.enabled && (
              <div
                className="pointer-events-none absolute top-0 h-full border-r-2 border-[var(--accent)] bg-gradient-to-r from-[var(--accent)]/25 to-[var(--accent)]/5"
                style={{ left: 0, width: pct(project.hook.end) }}
              >
                <span className="absolute left-1 top-1 rounded bg-[var(--accent)] px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--accent-contrast)]">
                  Hook
                </span>
              </div>
            )}
            {project.hook.enabled && (
              <div
                role="slider"
                aria-label="Hook length"
                aria-valuemin={2}
                aria-valuemax={15}
                aria-valuenow={Math.round(project.hook.end * 10) / 10}
                tabIndex={0}
                onPointerDown={beginHookDrag}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") onHookEndChange(Math.max(2, project.hook.end - 0.5));
                  if (event.key === "ArrowRight") onHookEndChange(Math.min(15, project.hook.end + 0.5));
                }}
                className="absolute top-0 z-10 h-full w-2 -translate-x-1/2 cursor-ew-resize rounded bg-[var(--accent)] opacity-80 hover:opacity-100"
                style={{ left: pct(project.hook.end) }}
                data-no-press
              />
            )}

            {/* Playhead */}
            <div className="pointer-events-none absolute top-0 z-20 h-full w-px bg-white" style={{ left: pct(time) }}>
              <span className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white shadow" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
