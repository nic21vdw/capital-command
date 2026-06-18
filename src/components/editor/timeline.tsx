"use client";

import { useRef } from "react";
import { formatClock } from "@/lib/clipping/editor";
import { cn } from "@/lib/utils";
import type { CaptionSegment, ClipProject, Overlay } from "@/types/domain";

const OVERLAY_COLORS = ["#7c5cff", "#39e08b", "#ffd34d", "#ff7aa8", "#5cc8ff"];

function useTrackGeometry(duration: number) {
  const ref = useRef<HTMLDivElement>(null);
  const pxToSec = (clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * duration;
  };
  return { ref, pxToSec };
}

export function EditorTimeline({
  project,
  time,
  duration,
  onSeek,
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
  onSeek: (t: number) => void;
  selectedCaptionId: string | null;
  onSelectCaption: (id: string | null) => void;
  onCaptionChange: (id: string, partial: Partial<CaptionSegment>) => void;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onOverlayChange: (id: string, partial: Partial<Overlay>) => void;
}) {
  const dur = Math.max(0.1, duration);
  const capGeom = useTrackGeometry(dur);
  const ovGeom = useTrackGeometry(dur);

  const ticks = Array.from({ length: Math.min(13, Math.ceil(dur) + 1) }, (_, i) => (i / Math.min(12, Math.ceil(dur))) * dur);

  // Drag a block by retiming it; all state is captured in the pointerdown
  // closure with window listeners, so nothing reads a ref during render.
  const beginDrag = (
    kind: "caption" | "overlay",
    item: { id: string; start: number; end: number },
    trackRef: React.RefObject<HTMLDivElement | null>
  ) => (e: React.PointerEvent) => {
    e.stopPropagation();
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

  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      {/* Ruler */}
      <div className="relative h-5 select-none text-[10px] text-[var(--muted-foreground)]">
        {ticks.map((t, i) => (
          <span key={i} className="absolute -translate-x-1/2" style={{ left: `${(t / dur) * 100}%` }}>
            {formatClock(t)}
          </span>
        ))}
      </div>

      {/* Caption track */}
      <Track
        label="Captions"
        geomRef={capGeom.ref}
        onSeek={(e) => onSeek(capGeom.pxToSec(e.clientX))}
        time={time}
        dur={dur}
      >
        {project.captions.map((c) => (
          <button
            key={c.id}
            type="button"
            onPointerDown={beginDrag("caption", c, capGeom.ref)}
            className={cn(
              "absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-left text-[10px] leading-tight transition",
              c.enabled ? "bg-[var(--accent)]/30 text-white" : "bg-white/5 text-white/40 line-through",
              selectedCaptionId === c.id && "ring-2 ring-[var(--accent)]"
            )}
            style={{ left: `${(c.start / dur) * 100}%`, width: `${Math.max(1.5, ((c.end - c.start) / dur) * 100)}%`, touchAction: "none" }}
            title={c.text}
          >
            <span className="line-clamp-2">{c.text}</span>
          </button>
        ))}
      </Track>

      {/* Overlay track */}
      <Track
        label="Overlays"
        geomRef={ovGeom.ref}
        onSeek={(e) => onSeek(ovGeom.pxToSec(e.clientX))}
        time={time}
        dur={dur}
      >
        {project.overlays.map((o, idx) => {
          const end = o.end > o.start ? o.end : dur;
          return (
            <button
              key={o.id}
              type="button"
              onPointerDown={beginDrag("overlay", { id: o.id, start: o.start, end }, ovGeom.ref)}
              className={cn(
                "absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-left text-[10px] text-black/80 transition",
                selectedOverlayId === o.id && "ring-2 ring-white"
              )}
              style={{
                left: `${(o.start / dur) * 100}%`,
                width: `${Math.max(1.5, ((end - o.start) / dur) * 100)}%`,
                background: OVERLAY_COLORS[idx % OVERLAY_COLORS.length],
                touchAction: "none"
              }}
              title={o.text ?? o.kind}
            >
              {o.kind === "image" || o.kind === "logo" || o.kind === "watermark" ? o.kind : o.text || "text"}
            </button>
          );
        })}
      </Track>
    </div>
  );
}

function Track({
  label,
  geomRef,
  onSeek,
  time,
  dur,
  children
}: {
  label: string;
  geomRef: React.RefObject<HTMLDivElement | null>;
  onSeek: (e: React.PointerEvent) => void;
  time: number;
  dur: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>
      <div
        ref={geomRef}
        className="relative h-10 flex-1 cursor-pointer rounded-lg bg-black/30"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSeek(e);
        }}
      >
        {children}
        {/* Playhead */}
        <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${(time / dur) * 100}%` }} />
      </div>
    </div>
  );
}
