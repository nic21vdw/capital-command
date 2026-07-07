"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Pause, Play } from "lucide-react";
import type { LongformProject } from "@/lib/longform/types";
import type { CaptionStyle } from "@/types/domain";
import { cn } from "@/lib/utils";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Live preview of the edited long-form video. The hook punch-in is emulated
// with a CSS transform (the export bakes the identical crop via ffmpeg) and
// the hook captions render word-synced on top, so what plays here is what
// exports. Cut segments are skipped by the parent's playback loop.

export function LongformPreview({
  project,
  time,
  playing,
  inCut,
  videoRef,
  onTogglePlay,
  focusEditing,
  onFocusChange,
  onCaptionStyleChange
}: {
  project: LongformProject;
  time: number;
  playing: boolean;
  /** True when the playhead sits inside footage the edit removes. */
  inCut: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTogglePlay: () => void;
  /** When true, clicking the frame moves the hook zoom focus point. */
  focusEditing: boolean;
  onFocusChange: (x: number, y: number) => void;
  /** Persist drag-to-move / drag-to-scale edits to the hook caption. */
  onCaptionStyleChange?: (partial: Partial<CaptionStyle>) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const [frameHeight, setFrameHeight] = useState(0);
  const [captionSelected, setCaptionSelected] = useState(false);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFrameHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hook = project.hook;
  const hookActive = hook.enabled && time < hook.end;
  const zoom = hookActive ? hook.zoom : 1;

  // The current hook caption + spoken word for the overlay.
  const activeCaption = useMemo(() => {
    if (!hookActive || !hook.captionsEnabled) return null;
    return hook.captions.find((seg) => seg.enabled && seg.text.trim() && time >= seg.start && time < seg.end) ?? null;
  }, [hookActive, hook.captionsEnabled, hook.captions, time]);

  const style = hook.captionStyle;
  const fontSize = Math.max(10, style.fontScale * frameHeight);
  const captionInteractive = Boolean(onCaptionStyleChange);
  const captionCustomPos = style.offsetX !== undefined && style.offsetY !== undefined;

  const handleFrameClick = (event: React.MouseEvent<HTMLDivElement>) => {
    setCaptionSelected(false);
    if (!focusEditing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onFocusChange(
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    );
  };

  // Drag the caption to reposition it (writes normalized offsetX/offsetY) or
  // drag the corner handle to scale the font. On the first move of a
  // preset-positioned caption we convert its measured center into offsets so
  // the block keeps its exact spot and then follows the pointer. Mirrors the
  // Shorts editor's CaptionLayer, and the export bakes the same offsets.
  const beginCaptionDrag = (mode: "move" | "scale") => (event: React.PointerEvent) => {
    if (!captionInteractive || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setCaptionSelected(true);
    const frameEl = frameRef.current;
    const block = captionRef.current;
    if (!frameEl || !block) return;
    const frameRect = frameEl.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    const startX = captionCustomPos
      ? (style.offsetX as number)
      : (blockRect.left + blockRect.width / 2 - frameRect.left) / Math.max(1, frameRect.width);
    const startY = captionCustomPos
      ? (style.offsetY as number)
      : (blockRect.top + blockRect.height / 2 - frameRect.top) / Math.max(1, frameRect.height);
    const startScale = style.fontScale;
    const sx = event.clientX;
    const sy = event.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (mode === "move") {
        onCaptionStyleChange?.({
          offsetX: clamp(startX + dx / Math.max(1, frameRect.width), 0.02, 0.98),
          offsetY: clamp(startY + dy / Math.max(1, frameRect.height), 0.02, 0.98)
        });
      } else {
        const px = startScale * frameRect.height + (dx + dy) / 2;
        onCaptionStyleChange?.({ fontScale: clamp(px / Math.max(1, frameRect.height), 0.04, 0.12) });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={frameRef}
      role="presentation"
      onClick={handleFrameClick}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border)] bg-black",
        focusEditing && "cursor-crosshair ring-2 ring-[var(--accent)]"
      )}
    >
      <div
        className="h-full w-full transition-transform duration-300 ease-out"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: `${hook.focusX * 100}% ${hook.focusY * 100}%`
        }}
      >
        <video
          ref={videoRef}
          src={`/api/clips/sources/${project.sourceId}/stream`}
          preload="metadata"
          playsInline
          className="h-full w-full object-contain"
        />
      </div>

      {/* Hook badge + captions overlay */}
      {hookActive && (
        <span className="absolute left-3 top-3 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-contrast)] shadow">
          Hook · {zoom.toFixed(2)}x
        </span>
      )}
      {inCut && !hookActive && (
        <span className="absolute left-3 top-3 rounded-full bg-red-500/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow">
          Cut in edit
        </span>
      )}

      {activeCaption && (
        <div
          className={cn(
            "pointer-events-none absolute z-20 flex",
            captionCustomPos ? "" : "inset-x-0 justify-center px-6"
          )}
          style={
            captionCustomPos
              ? {
                  left: `${(style.offsetX as number) * 100}%`,
                  top: `${(style.offsetY as number) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  maxWidth: "88%"
                }
              : style.position === "top"
                ? { top: "8%" }
                : style.position === "middle"
                  ? { top: "50%", transform: "translateY(-50%)" }
                  : style.position === "lower-third"
                    ? { bottom: "18%" }
                    : { bottom: "6%" }
          }
        >
          <p
            ref={captionRef}
            onPointerDown={beginCaptionDrag("move")}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "relative text-center leading-tight",
              captionInteractive && "pointer-events-auto cursor-move touch-none rounded-lg px-2 py-0.5",
              captionInteractive && captionSelected && "outline outline-2 outline-[var(--accent)]",
              captionInteractive && !captionSelected && "hover:outline hover:outline-1 hover:outline-white/50"
            )}
            style={{
              fontFamily: style.fontFamily,
              fontWeight: style.fontWeight,
              fontSize,
              color: style.textColor,
              textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.9)",
              textTransform: style.uppercase ? "uppercase" : undefined
            }}
          >
            {activeCaption.words.length > 0
              ? activeCaption.words.map((word, index) => {
                  const isCurrent =
                    hook.highlightCurrentWord &&
                    time >= word.start &&
                    (index === activeCaption.words.length - 1 || time < activeCaption.words[index + 1].start);
                  return (
                    <span
                      key={`${activeCaption.id}-${index}`}
                      style={isCurrent ? { color: style.highlightColor, transform: "scale(1.06)" } : undefined}
                      className="inline-block px-[0.14em] transition-colors duration-75"
                    >
                      {word.text}
                    </span>
                  );
                })
              : activeCaption.text}
            {captionInteractive && captionSelected && (
              <span
                onPointerDown={beginCaptionDrag("scale")}
                className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-[var(--accent)]"
              />
            )}
          </p>
        </div>
      )}

      {/* Focus crosshair while adjusting the hook zoom target */}
      {focusEditing && (
        <span
          className="pointer-events-none absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-black/40 text-[var(--accent)] shadow"
          style={{ left: `${hook.focusX * 100}%`, top: `${hook.focusY * 100}%` }}
        >
          <Crosshair className="h-4 w-4" />
        </span>
      )}

      {/* Click-to-play surface */}
      {!focusEditing && (
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="absolute inset-0 flex items-center justify-center"
          data-no-press
        >
          <span
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition",
              playing ? "opacity-0 hover:opacity-90" : "opacity-90"
            )}
          >
            {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
          </span>
        </button>
      )}
    </div>
  );
}
