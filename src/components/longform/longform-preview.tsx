"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Pause, Play } from "lucide-react";
import type { LongformProject } from "@/lib/longform/types";
import type { CaptionStyle } from "@/types/domain";
import { cn } from "@/lib/utils";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// How long the hook's punch-in zoom takes to ramp from 1x to the target zoom.
// Kept in sync with HOOK_ZOOM_RAMP_SEC in src/lib/longform/render.ts.
const HOOK_ZOOM_RAMP_SEC = 0.5;

// Live preview of the edited long-form video. The hook punch-in is emulated
// with a CSS transform (the export bakes the identical crop via ffmpeg) and
// the captions render word-synced on top — the hook's own captions inside the
// hook window, the whole-video captions everywhere else — so what plays here
// is what exports. Cut segments are skipped by the parent's playback loop.

export function LongformPreview({
  project,
  time,
  playing,
  inCut,
  videoRef,
  onTogglePlay,
  focusEditing,
  onFocusChange,
  onCaptionStyleChange,
  onBodyCaptionStyleChange,
  imageUrl
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
  /** Persist drag-to-move / drag-to-scale edits to the whole-video captions. */
  onBodyCaptionStyleChange?: (partial: Partial<CaptionStyle>) => void;
  /** Resolves an overlay to a displayable image URL. */
  imageUrl: (overlay: LongformProject["overlays"][number]) => string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(0);
  const [captionSelected, setCaptionSelected] = useState(false);

  // The 9:16 layout centers the video at full width over a blurred fill of
  // itself — exactly what the export bakes. The band the video occupies is a
  // fraction of the frame height, so the hook focus point (normalized over the
  // video image, like the export's reframe) maps through it.
  const vertical = (project.layout ?? "wide") === "vertical";
  const srcAspect = project.width > 0 && project.height > 0 ? project.width / project.height : 16 / 9;
  const bandFrac = vertical ? Math.min(1, 9 / 16 / srcAspect) : 1;
  const bandTopFrac = (1 - bandFrac) / 2;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFrameHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the blurred background copy locked to the main video. A little drift
  // is invisible behind the blur, so it only reseeks past a small threshold.
  useEffect(() => {
    if (!vertical) return;
    const main = videoRef.current;
    const bg = bgVideoRef.current;
    if (!main || !bg) return;
    const sync = () => {
      if (Math.abs(bg.currentTime - main.currentTime) > 0.25) bg.currentTime = main.currentTime;
      if (main.paused && !bg.paused) bg.pause();
      else if (!main.paused && bg.paused) void bg.play().catch(() => undefined);
    };
    sync();
    const events = ["play", "pause", "seeked", "timeupdate", "ratechange"] as const;
    for (const name of events) main.addEventListener(name, sync);
    return () => {
      for (const name of events) main.removeEventListener(name, sync);
      bg.pause();
    };
  }, [vertical, videoRef]);

  const hook = project.hook;
  const hookStart = hook.start ?? 0;
  const hookActive = hook.enabled && time >= hookStart && time < hook.end;
  // Match the export's animated punch-in: ease the zoom from 1x up to hook.zoom
  // over the first HOOK_ZOOM_RAMP_SEC seconds (ease-out cubic), then hold. This
  // makes the preview glide into the zoom at the hook's first frame instead of
  // snapping to full zoom — mirroring animatedReframeChain on the trimmed clip.
  const hookLen = Math.max(0.05, hook.end - hookStart);
  const rampSec = Math.min(HOOK_ZOOM_RAMP_SEC, hookLen / 2);
  const rampProgress = clamp((time - hookStart) / rampSec, 0, 1);
  const eased = 1 - Math.pow(1 - rampProgress, 3);
  const zoom = hookActive ? 1 + (hook.zoom - 1) * eased : 1;

  // The caption to overlay right now: the hook's own captions win inside the
  // hook window; the whole-video captions cover everything else — mirroring
  // exactly which layer the export burns at this instant. Hook captions are
  // stored hook-local (0 = the hook's first frame), so they're looked up
  // against the window-relative time; body captions stay in source seconds.
  const bodyCaptions = project.captions;
  const hookCaptionsBurned =
    hook.enabled && hook.captionsEnabled && hook.captions.some((seg) => seg.enabled && seg.text.trim());
  const activeLayer = useMemo(() => {
    if (hookActive && hookCaptionsBurned) {
      const local = time - hookStart;
      const seg = hook.captions.find((s) => s.enabled && s.text.trim() && local >= s.start && local < s.end);
      return seg
        ? {
            seg,
            style: hook.captionStyle,
            highlight: hook.highlightCurrentWord,
            onStyleChange: onCaptionStyleChange,
            captionTime: local
          }
        : null;
    }
    if (bodyCaptions?.enabled && !(hookCaptionsBurned && hookActive)) {
      const seg = bodyCaptions.segments.find((s) => s.enabled && s.text.trim() && time >= s.start && time < s.end);
      return seg
        ? {
            seg,
            style: bodyCaptions.style,
            highlight: bodyCaptions.highlightCurrentWord,
            onStyleChange: onBodyCaptionStyleChange,
            captionTime: time
          }
        : null;
    }
    return null;
  }, [hookActive, hookCaptionsBurned, hook, hookStart, bodyCaptions, time, onCaptionStyleChange, onBodyCaptionStyleChange]);

  const activeCaption = activeLayer?.seg ?? null;
  const captionTime = activeLayer?.captionTime ?? time;
  const style = activeLayer?.style ?? hook.captionStyle;
  const activeStyleChange = activeLayer?.onStyleChange;
  const fontSize = Math.max(10, style.fontScale * frameHeight);
  const captionInteractive = Boolean(activeStyleChange);
  const captionCustomPos = style.offsetX !== undefined && style.offsetY !== undefined;

  // Timeline images visible at the current source time.
  const activeOverlays = useMemo(
    () => project.overlays.filter((overlay) => time >= overlay.start && time < overlay.end),
    [project.overlays, time]
  );

  const handleFrameClick = (event: React.MouseEvent<HTMLDivElement>) => {
    setCaptionSelected(false);
    if (!focusEditing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // The focus point is normalized over the video image, so on the vertical
    // layout a click maps through the centered band the video occupies.
    const relY = (event.clientY - rect.top) / rect.height;
    onFocusChange(
      clamp((event.clientX - rect.left) / rect.width, 0, 1),
      clamp((relY - bandTopFrac) / bandFrac, 0, 1)
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
        activeStyleChange?.({
          offsetX: clamp(startX + dx / Math.max(1, frameRect.width), 0.02, 0.98),
          offsetY: clamp(startY + dy / Math.max(1, frameRect.height), 0.02, 0.98)
        });
      } else {
        const px = startScale * frameRect.height + (dx + dy) / 2;
        activeStyleChange?.({ fontScale: clamp(px / Math.max(1, frameRect.height), 0.04, 0.12) });
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
        "relative w-full overflow-hidden rounded-xl border border-[var(--border)] bg-black",
        vertical ? "mx-auto aspect-[9/16]" : "aspect-video",
        focusEditing && "cursor-crosshair ring-2 ring-[var(--accent)]"
      )}
      // Keep the tall frame from towering over the panels on wide screens.
      style={vertical ? { maxWidth: "min(100%, calc(70vh * 9 / 16))" } : undefined}
    >
      {/* Blurred, dimmed fill behind the centered video — vertical layout only. */}
      {vertical && (
        <video
          ref={bgVideoRef}
          src={`/api/clips/sources/${project.sourceId}/stream`}
          preload="metadata"
          playsInline
          muted
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-75"
        />
      )}
      <div
        className={cn(
          vertical ? "absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden" : "h-full w-full"
        )}
        style={vertical ? { aspectRatio: `${srcAspect}` } : undefined}
      >
        <div
          className="h-full w-full transition-transform duration-150 ease-out"
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
      </div>

      {/* Timeline image overlays */}
      {activeOverlays.map((overlay) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={overlay.id}
          src={imageUrl(overlay)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 select-none"
          style={{
            left: `${overlay.x * 100}%`,
            top: `${overlay.y * 100}%`,
            width: `${overlay.width * 100}%`,
            opacity: overlay.opacity
          }}
        />
      ))}

      {/* Hook badge + captions overlay */}
      {hookActive && (
        <span className="absolute left-3 top-3 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-contrast)] shadow">
          Hook · {hook.zoom.toFixed(2)}x
        </span>
      )}
      {inCut && !hookActive && (
        <span className="absolute left-3 top-3 rounded-full bg-red-500/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#fff] shadow">
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
              captionInteractive && !captionSelected && "hover:outline hover:outline-1 hover:outline-[#fff]/50"
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
                    (activeLayer?.highlight ?? false) &&
                    captionTime >= word.start &&
                    (index === activeCaption.words.length - 1 || captionTime < activeCaption.words[index + 1].start);
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
                className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize touch-none rounded-full border-2 border-[#fff] bg-[var(--accent)]"
              />
            )}
          </p>
        </div>
      )}

      {/* Focus crosshair while adjusting the hook zoom target */}
      {focusEditing && (
        <span
          className="pointer-events-none absolute z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-black/40 text-[var(--accent)] shadow"
          style={{ left: `${hook.focusX * 100}%`, top: `${(bandTopFrac + hook.focusY * bandFrac) * 100}%` }}
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
              "flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-[#fff] backdrop-blur transition",
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
