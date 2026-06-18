"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { aspectDimensions } from "@/lib/clipping/editor";
import { cn } from "@/lib/utils";
import type { CaptionStyle, ClipProject, Overlay } from "@/types/domain";

function captionPositionClasses(style: CaptionStyle): string {
  if (style.position === "top") return "top-[6%] items-start";
  if (style.position === "middle") return "top-1/2 -translate-y-1/2 items-center";
  if (style.position === "lower-third") return "bottom-[18%] items-end";
  return "bottom-[6%] items-end";
}

function activeSegment(project: ClipProject, t: number) {
  return project.captions.find((s) => s.enabled && t >= s.start && t < s.end);
}

function CaptionLayer({ project, time, frameH }: { project: ClipProject; time: number; frameH: number }) {
  if (!project.captionsVisible) return null;
  const seg = activeSegment(project, time);
  if (!seg) return null;
  const style = project.captionStyle;
  const fontSize = Math.max(8, style.fontScale * frameH);
  const align = style.alignment === "left" ? "text-left" : style.alignment === "right" ? "text-right" : "text-center";
  const bg =
    style.backgroundOpacity > 0.02
      ? hexWithAlpha(style.backgroundColor, style.backgroundOpacity)
      : "transparent";
  const text = style.uppercase ? seg.text.toUpperCase() : seg.text;

  return (
    <div className={cn("pointer-events-none absolute inset-x-0 flex px-[6%]", captionPositionClasses(style))}>
      <div className={cn("w-full", align)}>
        <span
          className="inline-block rounded-md px-2 py-0.5 leading-tight"
          style={{
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontSize,
            color: style.textColor,
            background: bg,
            textShadow: `0 0 ${Math.max(0, style.outlineWidth)}px #000, 0 ${style.shadow}px ${style.shadow * 2}px rgba(0,0,0,0.6)`,
            WebkitTextStroke: style.outlineWidth > 0 ? `${style.outlineWidth * 0.5}px #000` : undefined
          }}
        >
          {project.highlightCurrentWord && seg.words.length > 0
            ? seg.words.map((w, i) => {
                const active = time >= w.start && time < w.end;
                return (
                  <span key={i} style={{ color: active ? style.highlightColor : undefined }}>
                    {(style.uppercase ? w.text.toUpperCase() : w.text) + " "}
                  </span>
                );
              })
            : text}
        </span>
      </div>
    </div>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2) || "00", 16);
  const g = parseInt(clean.slice(2, 4) || "00", 16);
  const b = parseInt(clean.slice(4, 6) || "00", 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function OverlayItem({
  overlay,
  selected,
  frame,
  onSelect,
  onChange
}: {
  overlay: Overlay;
  selected: boolean;
  frame: { w: number; h: number };
  onSelect: () => void;
  onChange: (partial: Partial<Overlay>) => void;
}) {
  // Drag entirely inside the pointerdown handler via window listeners, so no
  // mutable ref is read during render.
  const onPointerDown = (mode: "move" | "scale" | "rotate") => (e: React.PointerEvent) => {
    if (overlay.locked) return;
    e.stopPropagation();
    onSelect();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = overlay.x;
    const oy = overlay.y;
    const os = overlay.scale;
    const orot = overlay.rotation;
    const move = (ev: PointerEvent) => {
      const dxFrac = (ev.clientX - sx) / frame.w;
      const dyFrac = (ev.clientY - sy) / frame.h;
      if (mode === "move") onChange({ x: clamp(ox + dxFrac, 0, 1), y: clamp(oy + dyFrac, 0, 1) });
      else if (mode === "scale") onChange({ scale: clamp(os + (dxFrac + dyFrac) * 2, 0.1, 8) });
      else onChange({ rotation: orot + dxFrac * 180 });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const isText = overlay.kind === "text" || overlay.kind === "title";

  return (
    <div
      className="absolute"
      style={{
        left: `${overlay.x * 100}%`,
        top: `${overlay.y * 100}%`,
        transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg) scale(${overlay.scale})`,
        opacity: overlay.opacity,
        cursor: overlay.locked ? "default" : "move",
        touchAction: "none"
      }}
      onPointerDown={onPointerDown("move")}
    >
      <div className={cn("relative", selected && "outline outline-2 outline-[var(--accent)]")}>
        {isText ? (
          <span
            className="block whitespace-pre px-1"
            style={{
              fontFamily: overlay.fontFamily ?? "Inter, system-ui, sans-serif",
              fontWeight: overlay.fontWeight ?? (overlay.kind === "title" ? 800 : 600),
              fontSize: (overlay.kind === "title" ? 0.09 : 0.05) * frame.h,
              color: overlay.color ?? "#ffffff",
              background: overlay.background ?? "transparent",
              textShadow: "0 2px 6px rgba(0,0,0,0.6)"
            }}
          >
            {overlay.text || "Text"}
          </span>
        ) : overlay.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={overlay.src} alt="" style={{ width: frame.w * 0.4, maxWidth: "none" }} draggable={false} />
        ) : null}

        {selected && !overlay.locked && (
          <>
            <span
              onPointerDown={onPointerDown("scale")}
              className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-[var(--accent)]"
              style={{ touchAction: "none" }}
            />
            <span
              onPointerDown={onPointerDown("rotate")}
              className="absolute -top-7 left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white bg-[var(--accent)]"
              style={{ touchAction: "none" }}
            >
              <RotateCw className="h-3 w-3 text-white" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function EditorPreview({
  project,
  time,
  videoSrc,
  onVideoReady,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayChange
}: {
  project: ClipProject;
  time: number;
  videoSrc: string;
  onVideoReady: (el: HTMLVideoElement | null) => void;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onOverlayChange: (id: string, partial: Partial<Overlay>) => void;
}) {
  const dims = aspectDimensions(project.aspectRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ w: 360, h: 640 });

  // Measure the rendered frame so overlay/caption sizing is pixel-accurate.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [project.aspectRatio]);

  // Expose the foreground video to the parent for transport control.
  useEffect(() => {
    onVideoReady(fgRef.current);
    return () => onVideoReady(null);
  }, [onVideoReady]);

  // Keep the blurred background copy in lock-step with the foreground.
  useEffect(() => {
    const fg = fgRef.current;
    const bg = bgRef.current;
    if (!fg || !bg) return;
    const sync = () => {
      if (Math.abs(bg.currentTime - fg.currentTime) > 0.12) bg.currentTime = fg.currentTime;
      if (fg.paused && !bg.paused) bg.pause();
      if (!fg.paused && bg.paused) void bg.play().catch(() => undefined);
    };
    fg.addEventListener("play", sync);
    fg.addEventListener("pause", sync);
    fg.addEventListener("seeked", sync);
    fg.addEventListener("timeupdate", sync);
    return () => {
      fg.removeEventListener("play", sync);
      fg.removeEventListener("pause", sync);
      fg.removeEventListener("seeked", sync);
      fg.removeEventListener("timeupdate", sync);
    };
  }, [videoSrc]);

  const frameW = frameSize.w;
  const frameH = frameSize.h;
  const { scale, offsetX, offsetY } = project.reframe;
  const visibleOverlays = [...project.overlays]
    .filter((o) => time >= o.start && (o.end <= o.start || time <= o.end))
    .sort((a, b) => a.z - b.z);

  return (
    <div ref={containerRef} className="flex items-center justify-center">
      <div
        ref={frameRef}
        className="relative max-h-[62vh] overflow-hidden rounded-xl bg-black ring-1 ring-white/10"
        style={{ aspectRatio: `${dims.w} / ${dims.h}`, width: dims.w >= dims.h ? "min(100%, 720px)" : "auto", height: dims.w >= dims.h ? "auto" : "62vh" }}
        onPointerDown={() => onSelectOverlay(null)}
      >
        {/* Blurred fill background (mirrors the export's reframe). */}
        <video
          ref={bgRef}
          src={videoSrc}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter: "blur(24px) brightness(0.6)", transform: "scale(1.1)" }}
        />
        {/* Foreground video with reframe transform. */}
        <video
          ref={fgRef}
          src={videoSrc}
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
          style={{ transform: `scale(${scale}) translate(${offsetX * 25}%, ${offsetY * 25}%)` }}
        />

        {/* Safe-area guide. */}
        <div className="pointer-events-none absolute inset-[5%] rounded-md border border-dashed border-white/15" />

        {visibleOverlays.map((overlay) => (
          <OverlayItem
            key={overlay.id}
            overlay={overlay}
            selected={overlay.id === selectedOverlayId}
            frame={{ w: frameW, h: frameH }}
            onSelect={() => onSelectOverlay(overlay.id)}
            onChange={(partial) => onOverlayChange(overlay.id, partial)}
          />
        ))}

        <CaptionLayer project={project} time={time} frameH={frameH} />
      </div>
    </div>
  );
}
