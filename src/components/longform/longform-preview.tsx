"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Pause, Play } from "lucide-react";
import type { LongformProject } from "@/lib/longform/types";
import { cn } from "@/lib/utils";

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
  /** Resolves an overlay to a displayable image URL. */
  imageUrl: (overlay: LongformProject["overlays"][number]) => string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState(0);

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

  // Timeline images visible at the current source time.
  const activeOverlays = useMemo(
    () => project.overlays.filter((overlay) => time >= overlay.start && time < overlay.end),
    [project.overlays, time]
  );

  const handleFrameClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!focusEditing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onFocusChange(
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    );
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
          className="pointer-events-none absolute inset-x-0 flex justify-center px-6"
          style={
            style.position === "top"
              ? { top: "8%" }
              : style.position === "middle"
                ? { top: "50%", transform: "translateY(-50%)" }
                : style.position === "lower-third"
                  ? { bottom: "18%" }
                  : { bottom: "6%" }
          }
        >
          <p
            className="text-center leading-tight"
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
