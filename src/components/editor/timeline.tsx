"use client";

import { useRef, useState } from "react";
import { Minus, Plus, RotateCcw, Scissors } from "lucide-react";
import { formatClock } from "@/lib/clipping/editor";
import { clipEditedDurationSec, ensureClipSegments } from "@/lib/clipping/segments";
import { cn } from "@/lib/utils";
import type { CaptionSegment, ClipEditSegment, ClipProject, Overlay } from "@/types/domain";

const OVERLAY_COLORS = ["#7c5cff", "#39e08b", "#ffd34d", "#ff7aa8", "#5cc8ff"];
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** Candidate ruler tick intervals in seconds, coarsest that still fits wins. */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function EditorTimeline({
  project,
  time,
  duration,
  trimStart,
  trimEnd,
  onSeek,
  onSetTrim,
  onResetTrim,
  onSplit,
  onToggleSegment,
  onSegmentBoundaryChange,
  onSetSilenceIncluded,
  selectedCaptionId,
  onSelectCaption,
  onCaptionChange,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayChange
}: {
  project: ClipProject;
  time: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  onSeek: (t: number) => void;
  onSetTrim: (start: number, end: number) => void;
  onResetTrim: () => void;
  onSplit: () => void;
  onToggleSegment: (id: string) => void;
  onSegmentBoundaryChange: (leftId: string, boundary: number) => void;
  onSetSilenceIncluded: (included: boolean) => void;
  selectedCaptionId: string | null;
  onSelectCaption: (id: string | null) => void;
  onCaptionChange: (id: string, partial: Partial<CaptionSegment>) => void;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onOverlayChange: (id: string, partial: Partial<Overlay>) => void;
}) {
  const dur = Math.max(0.1, duration);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const pxToSec = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((clientX - rect.left) / rect.width) * dur));
  };

  const selectedSec = Math.max(0, trimEnd - trimStart);
  const segments = ensureClipSegments(dur, project.captions, project.segments);
  const editedSec = clipEditedDurationSec(dur, trimStart, trimEnd, segments);
  const removedSec = Math.max(0, selectedSec - editedSec);
  const hasSilence = segments.some((segment) => segment.kind === "silence");
  const silenceIncluded = hasSilence && segments.every((segment) => segment.kind !== "silence" || segment.enabled);
  const trimmed = trimStart > 0.05 || trimEnd < dur - 0.05;
  const canSplit = time > trimStart + 0.2 && time < trimEnd - 0.2;

  // Keep the point under the cursor fixed while zooming, so zooming in doesn't
  // fling the view away from what you were looking at.
  const setZoomKeepingCenter = (next: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    const scroller = scrollRef.current;
    if (scroller && clamped !== zoom) {
      const viewport = scroller.clientWidth;
      const centerFrac = (scroller.scrollLeft + viewport / 2) / Math.max(1, viewport * zoom);
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, centerFrac * viewport * clamped - viewport / 2);
      });
    }
    setZoom(clamped);
  };

  // --- pointer interactions ------------------------------------------------

  /** Click/drag on the empty track scrubs the playhead. */
  const beginScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // keep the browser from starting a text selection that spreads across the page
    onSeek(pxToSec(e.clientX));
    const move = (ev: PointerEvent) => onSeek(pxToSec(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const beginTrimDrag = (mode: "start" | "end" | "move", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const grabX = e.clientX;
    const grabAt = pxToSec(grabX);
    const startAtGrab = trimStart;
    const endAtGrab = trimEnd;
    // For "move", a plain click should seek — only slide the selection once the
    // pointer has clearly moved. Otherwise clicking inside the kept range would
    // never reposition the playhead.
    let sliding = false;
    const move = (ev: PointerEvent) => {
      const t = pxToSec(ev.clientX);
      if (mode === "start") {
        const next = Math.min(t, endAtGrab - 0.2);
        onSetTrim(next, endAtGrab);
        onSeek(next);
      } else if (mode === "end") {
        const next = Math.max(t, startAtGrab + 0.2);
        onSetTrim(startAtGrab, next);
        onSeek(next);
      } else {
        if (!sliding && Math.abs(ev.clientX - grabX) < 5) return;
        sliding = true;
        const len = endAtGrab - startAtGrab;
        const nextStart = Math.max(0, Math.min(dur - len, startAtGrab + (t - grabAt)));
        onSetTrim(nextStart, nextStart + len);
      }
    };
    const up = () => {
      if (mode === "move" && !sliding) onSeek(grabAt);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Resize a cut/kept segment by moving its shared boundary with the next one. */
  const beginSegmentBoundaryDrag = (segment: ClipEditSegment, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const boundary = pxToSec(ev.clientX);
      onSegmentBoundaryChange(segment.id, boundary);
      onSeek(boundary);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Drag a caption/overlay block sideways to retime it. */
  const beginBlockDrag = (
    kind: "caption" | "overlay",
    item: { id: string; start: number; end: number }
  ) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (kind === "caption") onSelectCaption(item.id);
    else onSelectOverlay(item.id);
    const startX = e.clientX;
    const width = trackRef.current?.getBoundingClientRect().width ?? 1;
    const len = item.end - item.start;
    const move = (ev: PointerEvent) => {
      const deltaSec = ((ev.clientX - startX) / width) * dur;
      const ns = Math.max(0, Math.min(dur - len, item.start + deltaSec));
      const partial = { start: ns, end: ns + len };
      if (kind === "caption") onCaptionChange(item.id, partial);
      else onOverlayChange(item.id, partial);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- ruler ---------------------------------------------------------------

  const visibleSec = dur / zoom;
  const tickStep = TICK_STEPS.find((step) => visibleSec / step <= 10) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= dur + 0.001; t += tickStep) ticks.push(Math.min(t, dur));

  const pct = (t: number) => `${(Math.max(0, Math.min(dur, t)) / dur) * 100}%`;

  return (
    <div className="select-none space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      {/* Toolbar: selection readout + zoom + trim actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm text-white">
          <span className="font-mono">{formatClock(trimStart)}</span>
          <span className="text-[var(--muted-foreground)]"> – </span>
          <span className="font-mono">{formatClock(trimEnd)}</span>
          <span className="ml-2 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
            {editedSec.toFixed(1)}s kept
          </span>
          {removedSec > 0.04 && (
            <span className="ml-2 rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-300">
              {removedSec.toFixed(1)}s cut
            </span>
          )}
          {(selectedCaptionId || selectedOverlayId) && (
            <span className="ml-2 text-xs text-[var(--muted-foreground)]">
              Press <kbd className="rounded border border-[var(--border)] px-1 font-mono text-[10px] text-white">Delete</kbd> to remove
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSetSilenceIncluded(!silenceIncluded)}
            disabled={!hasSilence}
            title={silenceIncluded ? "Cut the detected silent gaps" : "Put every detected silent gap back in"}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-40",
              !silenceIncluded && hasSilence
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            {silenceIncluded ? "Cut silence" : "Silence cut"}
          </button>
          <button
            type="button"
            onClick={onSplit}
            disabled={!canSplit}
            title={canSplit ? "Split the selection at the playhead" : "Move the playhead inside the selection to split"}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition enabled:hover:border-[var(--border-strong)] enabled:hover:text-white disabled:opacity-40"
          >
            <Scissors className="h-3.5 w-3.5" />
            Split
          </button>
          <button
            type="button"
            onClick={onResetTrim}
            disabled={!trimmed}
            title="Reset the trim to the whole clip"
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition enabled:hover:border-[var(--border-strong)] enabled:hover:text-white disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <span className="mx-1 h-5 w-px bg-[var(--border)]" />
          <button
            type="button"
            onClick={() => setZoomKeepingCenter(zoom / 1.5)}
            disabled={zoom <= MIN_ZOOM}
            title="Zoom out"
            aria-label="Zoom timeline out"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition enabled:hover:text-white disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-xs text-[var(--muted-foreground)]">{zoom.toFixed(1)}x</span>
          <button
            type="button"
            onClick={() => setZoomKeepingCenter(zoom * 1.5)}
            disabled={zoom >= MAX_ZOOM}
            title="Zoom in"
            aria-label="Zoom timeline in"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition enabled:hover:text-white disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-1">
        {/* px-1.5 gives the half-width handle overhang at 0%/100% room inside
            the scroll clip, so the extreme handles stay clickable. */}
        <div className="px-1.5" style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
          {/* Ruler */}
          <div
            className="relative h-5 cursor-pointer select-none text-[10px] text-[var(--muted-foreground)]"
            onPointerDown={beginScrub}
          >
            {ticks.map((t) => (
              <span key={t} className="pointer-events-none absolute -translate-x-1/2" style={{ left: pct(t) }}>
                {formatClock(t)}
              </span>
            ))}
          </div>

          {/* Main clip track: long-form-style keep/cut blocks inside the outer trim. */}
          <div
            ref={trackRef}
            className="relative h-16 overflow-visible rounded-lg bg-black/40"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) beginScrub(event);
            }}
          >
            {segments.map((segment) => {
              const isCut = !segment.enabled;
              const isSilence = segment.kind === "silence";
              return (
                <button
                  key={segment.id}
                  type="button"
                  data-no-press
                  onClick={() => onToggleSegment(segment.id)}
                  className={cn(
                    "absolute inset-y-1 overflow-hidden rounded border px-1 text-left text-[10px] font-medium transition",
                    isCut
                      ? "border-red-400/30 bg-red-500/15 text-red-200/70 line-through"
                      : isSilence
                        ? "border-amber-300/35 bg-amber-300/15 text-amber-100"
                        : "border-[var(--accent)]/35 bg-[var(--accent)]/18 text-[#fff]"
                  )}
                  style={{
                    left: pct(segment.start),
                    width: `${Math.max(0.35, ((segment.end - segment.start) / dur) * 100)}%`
                  }}
                  title={`${isSilence ? "Silent gap" : "Footage"} ${formatClock(segment.start)}–${formatClock(segment.end)} — click to ${isCut ? "keep" : "cut"}`}
                >
                  <span className="block truncate">{isCut ? "CUT" : isSilence ? "SILENCE" : "KEEP"}</span>
                </button>
              );
            })}

            {/* Shared segment boundaries resize the detected cuts. */}
            {segments.slice(0, -1).map((segment) => (
              <span
                key={segment.id + "-boundary"}
                role="slider"
                aria-label="Segment boundary"
                aria-valuemin={segment.start}
                aria-valuemax={dur}
                aria-valuenow={segment.end}
                tabIndex={0}
                onPointerDown={(event) => beginSegmentBoundaryDrag(segment, event)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") onSegmentBoundaryChange(segment.id, segment.end - 0.1);
                  if (event.key === "ArrowRight") onSegmentBoundaryChange(segment.id, segment.end + 0.1);
                }}
                className="absolute inset-y-1 z-10 w-2 -translate-x-1/2 cursor-ew-resize rounded-sm bg-[#fff]/0 transition hover:bg-[#fff]/50 focus:bg-[#fff]/50"
                style={{ left: pct(segment.end), touchAction: "none" }}
              />
            ))}

            {/* Anything outside the outer trim stays visibly unavailable. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 rounded-l-lg bg-black/65" style={{ width: pct(trimStart) }} />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-10 rounded-r-lg bg-black/65"
              style={{ width: `${((dur - trimEnd) / dur) * 100}%` }}
            />

            {/* Dragging the thin band slides the complete outer clip window. */}
            <div
              className="absolute inset-x-0 bottom-0 z-20 h-2 cursor-grab border-b-2 border-[var(--accent)] active:cursor-grabbing"
              style={{ left: pct(trimStart), width: `${(selectedSec / dur) * 100}%`, touchAction: "none" }}
              onPointerDown={(event) => beginTrimDrag("move", event)}
              title="Drag to slide the complete clip window"
            />

            {/* Outer trim handles change the complete clip length. */}
            <div
              role="slider"
              aria-label="Trim start"
              aria-valuemin={0}
              aria-valuemax={Math.round(dur * 100) / 100}
              aria-valuenow={Math.round(trimStart * 100) / 100}
              tabIndex={0}
              className="absolute inset-y-0 z-30 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm bg-[var(--accent)]"
              style={{ left: pct(trimStart), touchAction: "none" }}
              onPointerDown={(event) => beginTrimDrag("start", event)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") onSetTrim(Math.max(0, trimStart - 0.1), trimEnd);
                if (event.key === "ArrowRight") onSetTrim(Math.min(trimEnd - 0.2, trimStart + 0.1), trimEnd);
              }}
              title="Drag to change the clip start"
            >
              <span className="h-6 w-0.5 rounded-full bg-black/50" />
            </div>
            <div
              role="slider"
              aria-label="Trim end"
              aria-valuemin={0}
              aria-valuemax={Math.round(dur * 100) / 100}
              aria-valuenow={Math.round(trimEnd * 100) / 100}
              tabIndex={0}
              className="absolute inset-y-0 z-30 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm bg-[var(--accent)]"
              style={{ left: pct(trimEnd), touchAction: "none" }}
              onPointerDown={(event) => beginTrimDrag("end", event)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") onSetTrim(trimStart, Math.max(trimStart + 0.2, trimEnd - 0.1));
                if (event.key === "ArrowRight") onSetTrim(trimStart, Math.min(dur, trimEnd + 0.1));
              }}
              title="Drag to change the clip end"
            >
              <span className="h-6 w-0.5 rounded-full bg-black/50" />
            </div>

            <Playhead time={time} dur={dur} />
          </div>

          {/* Caption blocks */}
          {project.captions.length > 0 && (
            <TrackRow label="Captions" onPointerDown={beginScrub} time={time} dur={dur}>
              {project.captions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-no-press
                  onPointerDown={beginBlockDrag("caption", c)}
                  className={cn(
                    "absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-left text-[10px] leading-tight transition",
                    c.enabled ? "bg-[var(--accent)]/30 text-[#fff]" : "bg-[#fff]/5 text-[#fff]/40 line-through",
                    selectedCaptionId === c.id && "ring-2 ring-[var(--accent)]"
                  )}
                  style={{
                    left: pct(c.start),
                    width: `${Math.max(1, ((c.end - c.start) / dur) * 100)}%`,
                    touchAction: "none"
                  }}
                  title={c.text}
                >
                  <span className="line-clamp-2">{c.text}</span>
                </button>
              ))}
            </TrackRow>
          )}

          {/* Overlay blocks */}
          {project.overlays.length > 0 && (
            <TrackRow label="Overlays" onPointerDown={beginScrub} time={time} dur={dur}>
              {project.overlays.map((o, idx) => {
                const end = o.end > o.start ? o.end : dur;
                return (
                  <button
                    key={o.id}
                    type="button"
                    data-no-press
                    onPointerDown={beginBlockDrag("overlay", { id: o.id, start: o.start, end })}
                    className={cn(
                      "absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-left text-[10px] text-black/80 transition",
                      selectedOverlayId === o.id && "ring-2 ring-[#fff]"
                    )}
                    style={{
                      left: pct(o.start),
                      width: `${Math.max(1, ((end - o.start) / dur) * 100)}%`,
                      background: OVERLAY_COLORS[idx % OVERLAY_COLORS.length],
                      touchAction: "none"
                    }}
                    title={o.text ?? o.kind}
                  >
                    {o.kind === "image" || o.kind === "logo" || o.kind === "watermark" ? o.kind : o.text || "text"}
                  </button>
                );
              })}
            </TrackRow>
          )}
        </div>
      </div>
    </div>
  );
}

function Playhead({ time, dur }: { time: number; dur: number }) {
  const left = `${(Math.max(0, Math.min(dur, time)) / dur) * 100}%`;
  return (
    <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-[#fff]" style={{ left }}>
      <span className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[#fff]" />
    </div>
  );
}

function TrackRow({
  label,
  onPointerDown,
  time,
  dur,
  children
}: {
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
  time: number;
  dur: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <div
        className="relative h-9 cursor-pointer rounded-lg bg-black/30"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onPointerDown(e);
        }}
      >
        {children}
        <Playhead time={time} dur={dur} />
      </div>
    </div>
  );
}
