"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Minus, Plus } from "lucide-react";
import { formatClock } from "@/lib/clipping/editor";
import type { LongformOverlay, LongformProject } from "@/lib/longform/types";
import { cn } from "@/lib/utils";

const round3 = (value: number) => Math.round(value * 1000) / 1000;

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

export type TimelineSelection = { start: number; end: number };

export function LongformTimeline({
  project,
  time,
  peaks,
  selection,
  onSeek,
  onToggleSegment,
  onHookEndChange,
  onSelectionChange,
  imageUrl,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayChange,
  onDropImage
}: {
  project: LongformProject;
  time: number;
  peaks: number[];
  selection: TimelineSelection | null;
  onSeek: (t: number) => void;
  onToggleSegment: (id: string) => void;
  onHookEndChange: (end: number) => void;
  onSelectionChange: (selection: TimelineSelection | null) => void;
  imageUrl: (overlay: LongformOverlay) => string;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onOverlayChange: (id: string, patch: Partial<Pick<LongformOverlay, "start" | "end">>) => void;
  onDropImage: (file: File, timeSec: number) => void;
}) {
  const duration = Math.max(0.1, project.durationSec);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const draggingRef = useRef<"scrub" | "hook" | "sel-start" | "sel-end" | "overlay" | null>(null);
  const overlays = project.overlays;

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

  const beginSelectionDrag = useCallback(
    (edge: "sel-start" | "sel-end") => (event: React.PointerEvent) => {
      if (!selection) return;
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = edge;
      const fixed = edge === "sel-start" ? selection.end : selection.start;
      const move = (e: PointerEvent) => {
        if (draggingRef.current !== edge) return;
        const t = timeFromPointer(e.clientX);
        const start = edge === "sel-start" ? Math.min(t, fixed - 0.05) : fixed;
        const end = edge === "sel-start" ? fixed : Math.max(t, fixed + 0.05);
        onSelectionChange({ start: Math.max(0, start), end: Math.min(duration, end) });
      };
      const up = () => {
        draggingRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [selection, duration, onSelectionChange, timeFromPointer]
  );

  // Drag an overlay along the timeline: the body moves it, the edges resize it.
  const beginOverlayDrag = useCallback(
    (event: React.PointerEvent, overlay: LongformOverlay, mode: "move" | "left" | "right") => {
      event.preventDefault();
      event.stopPropagation();
      onSelectOverlay(overlay.id);
      draggingRef.current = "overlay";
      const anchor = timeFromPointer(event.clientX);
      const orig = { start: overlay.start, end: overlay.end };
      const span = orig.end - orig.start;
      const move = (e: PointerEvent) => {
        if (draggingRef.current !== "overlay") return;
        const delta = timeFromPointer(e.clientX) - anchor;
        if (mode === "move") {
          const start = Math.max(0, Math.min(orig.start + delta, duration - span));
          onOverlayChange(overlay.id, { start: round3(start), end: round3(start + span) });
        } else if (mode === "left") {
          const start = Math.max(0, Math.min(orig.start + delta, orig.end - 0.2));
          onOverlayChange(overlay.id, { start: round3(start) });
        } else {
          const end = Math.min(duration, Math.max(orig.end + delta, orig.start + 0.2));
          onOverlayChange(overlay.id, { end: round3(end) });
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
    [duration, onOverlayChange, onSelectOverlay, timeFromPointer]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (files.length === 0) return;
      const dropTime = timeFromPointer(event.clientX);
      for (const file of files) onDropImage(file, dropTime);
    },
    [onDropImage, timeFromPointer]
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
          {selection
            ? "Drag the blue handles to fine-tune your selection, then press Delete (or use Remove/Keep in the Trim panel)."
            : "Click a red block to keep it, or kept footage to cut it. Drag the purple handle to resize the hook. Drop images here and drag them along the image track — press Delete to remove a selected image."}
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

      <div
        ref={scrollRef}
        className={cn(
          "relative overflow-x-auto pb-1",
          dragOver && "rounded-lg outline-dashed outline-2 outline-[var(--accent)]"
        )}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
            event.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragOver(false);
        }}
        onDrop={handleDrop}
      >
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

            {/* Manual trim selection */}
            {selection && (
              <>
                <div
                  className="pointer-events-none absolute top-0 z-10 h-full border-x-2 border-sky-400 bg-sky-400/20"
                  style={{ left: pct(selection.start), width: `${((selection.end - selection.start) / duration) * 100}%` }}
                >
                  <span className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded bg-sky-400 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
                    Selection
                  </span>
                </div>
                <div
                  role="slider"
                  aria-label="Selection start"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration * 10) / 10}
                  aria-valuenow={Math.round(selection.start * 10) / 10}
                  tabIndex={0}
                  onPointerDown={beginSelectionDrag("sel-start")}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") onSelectionChange({ ...selection, start: Math.max(0, selection.start - 0.25) });
                    if (event.key === "ArrowRight") onSelectionChange({ ...selection, start: Math.min(selection.end - 0.05, selection.start + 0.25) });
                  }}
                  className="absolute top-0 z-20 h-full w-2 -translate-x-1/2 cursor-ew-resize rounded bg-sky-400 opacity-90 hover:opacity-100"
                  style={{ left: pct(selection.start) }}
                  data-no-press
                />
                <div
                  role="slider"
                  aria-label="Selection end"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration * 10) / 10}
                  aria-valuenow={Math.round(selection.end * 10) / 10}
                  tabIndex={0}
                  onPointerDown={beginSelectionDrag("sel-end")}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") onSelectionChange({ ...selection, end: Math.max(selection.start + 0.05, selection.end - 0.25) });
                    if (event.key === "ArrowRight") onSelectionChange({ ...selection, end: Math.min(duration, selection.end + 0.25) });
                  }}
                  className="absolute top-0 z-20 h-full w-2 -translate-x-1/2 cursor-ew-resize rounded bg-sky-400 opacity-90 hover:opacity-100"
                  style={{ left: pct(selection.end) }}
                  data-no-press
                />
              </>
            )}

            {/* Playhead */}
            <div className="pointer-events-none absolute top-0 z-30 h-full w-px bg-white" style={{ left: pct(time) }}>
              <span className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white shadow" />
            </div>
          </div>

          {/* Image overlay track */}
          <div className="relative mt-2 h-12 rounded-lg bg-[var(--surface-2)]">
            {overlays.length === 0 ? (
              <div className="pointer-events-none flex h-full items-center justify-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                <ImagePlus className="h-3.5 w-3.5" /> Drop an image here to overlay it
              </div>
            ) : (
              overlays.map((overlay) => {
                const width = `${(Math.max(0.2, overlay.end - overlay.start) / duration) * 100}%`;
                const selected = overlay.id === selectedOverlayId;
                return (
                  <div
                    key={overlay.id}
                    role="button"
                    tabIndex={0}
                    title={`${overlay.fileName} — ${formatClock(overlay.start)}–${formatClock(overlay.end)} · drag to move`}
                    onPointerDown={(event) => beginOverlayDrag(event, overlay, "move")}
                    onKeyDown={(event) => {
                      const span = overlay.end - overlay.start;
                      if (event.key === "ArrowLeft") {
                        const start = Math.max(0, overlay.start - 0.5);
                        onOverlayChange(overlay.id, { start: round3(start), end: round3(start + span) });
                      }
                      if (event.key === "ArrowRight") {
                        const start = Math.min(duration - span, overlay.start + 0.5);
                        onOverlayChange(overlay.id, { start: round3(start), end: round3(start + span) });
                      }
                    }}
                    className={cn(
                      "group absolute top-1 bottom-1 flex cursor-grab items-center gap-1 overflow-hidden rounded-md border pl-1 pr-1 text-[10px] transition active:cursor-grabbing",
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent)]/25 text-white ring-1 ring-[var(--accent)]"
                        : "border-[var(--border-strong)] bg-black/40 text-[var(--muted-foreground)] hover:text-white"
                    )}
                    style={{ left: pct(overlay.start), width }}
                    data-no-press
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(overlay)}
                      alt=""
                      draggable={false}
                      className="pointer-events-none h-full w-6 shrink-0 rounded-sm object-cover"
                    />
                    <span className="truncate">{overlay.fileName}</span>
                    <span
                      onPointerDown={(event) => beginOverlayDrag(event, overlay, "left")}
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-transparent group-hover:bg-[var(--accent)]/60"
                    />
                    <span
                      onPointerDown={(event) => beginOverlayDrag(event, overlay, "right")}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-transparent group-hover:bg-[var(--accent)]/60"
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
