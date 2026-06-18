"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AspectRatio, ClipFraming, VideoClip } from "@/types/domain";
import { computeLayerStyle } from "./presets";

type Dims = { w: number; h: number };

/** A muted <video> that mirrors the primary element's time and play state. */
function SyncedVideo({
  primaryRef,
  src,
  className,
  style
}: {
  primaryRef: React.RefObject<HTMLVideoElement | null>;
  src: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const p = primaryRef.current;
      const v = ref.current;
      if (p && v && v.readyState >= 1) {
        if (Math.abs(v.currentTime - p.currentTime) > 0.18) v.currentTime = p.currentTime;
        if (!p.paused && v.paused) void v.play().catch(() => undefined);
        if (p.paused && !v.paused) v.pause();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [primaryRef]);
  return <video ref={ref} src={src} muted playsInline preload="auto" className={className} style={style} />;
}

function CameraLayer({
  primaryRef,
  src,
  frame,
  dims,
  camera
}: {
  primaryRef: React.RefObject<HTMLVideoElement | null>;
  src: string;
  frame: Dims;
  dims: Dims;
  camera: VideoClip["camera"];
}) {
  const destW = frame.w * camera.destRect.w;
  const destH = frame.h * camera.destRect.h;
  const layer = computeLayerStyle(destW, destH, dims.w, dims.h, {
    mode: "fill",
    x: 0,
    y: 0,
    scale: 1,
    srcRect: camera.srcRect
  });
  return (
    <div
      className="absolute overflow-hidden ring-2 ring-black/40"
      style={{
        left: `${camera.destRect.x * 100}%`,
        top: `${camera.destRect.y * 100}%`,
        width: `${camera.destRect.w * 100}%`,
        height: `${camera.destRect.h * 100}%`,
        borderRadius: camera.radius ? `${camera.radius}px` : undefined
      }}
    >
      <SyncedVideo
        primaryRef={primaryRef}
        src={src}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${layer.videoW}px`,
          height: `${layer.videoH}px`,
          transformOrigin: "0 0",
          transform: `translate(${layer.tx}px, ${layer.ty}px) scale(${layer.scale})`
        }}
      />
    </div>
  );
}

export function Preview({
  videoRef,
  src,
  aspect,
  clip,
  framing,
  source,
  showSafeAreas,
  onLoadedMetadata,
  onFramingLive,
  onFramingCommit
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  src: string | null;
  aspect: AspectRatio;
  clip: VideoClip | null;
  framing: ClipFraming;
  source: { width: number; height: number } | null;
  showSafeAreas: boolean;
  onLoadedMetadata: () => void;
  onFramingLive: (next: ClipFraming) => void;
  onFramingCommit: (next: ClipFraming) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Dims>({ w: 0, h: 0 });
  const [dims, setDims] = useState<Dims>({ w: source?.width || 0, h: source?.height || 0 });

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect.w, aspect.h]);

  const handleLoaded = useCallback(() => {
    const video = videoRef.current;
    if (video && video.videoWidth) setDims({ w: video.videoWidth, h: video.videoHeight });
    onLoadedMetadata();
  }, [onLoadedMetadata, videoRef]);

  const primaryLayer = useMemo(
    () => computeLayerStyle(frame.w, frame.h, dims.w, dims.h, framing),
    [frame.w, frame.h, dims.w, dims.h, framing]
  );

  // --- Drag to pan / wheel to zoom ---
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const framingRef = useRef(framing);
  useEffect(() => {
    framingRef.current = framing;
  }, [framing]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!clip) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: framing.x, baseY: framing.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || frame.w === 0) return;
    const dx = (e.clientX - drag.startX) / frame.w;
    const dy = (e.clientY - drag.startY) / frame.h;
    onFramingLive({ ...framingRef.current, x: drag.baseX + dx, y: drag.baseY + dy });
  };
  const onPointerUp = () => {
    if (dragRef.current) {
      dragRef.current = null;
      onFramingCommit(framingRef.current);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!clip) return;
    const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    const scale = Math.max(0.2, Math.min(8, framingRef.current.scale * factor));
    onFramingCommit({ ...framingRef.current, scale });
  };

  const aspectStyle: React.CSSProperties = { aspectRatio: `${aspect.w} / ${aspect.h}` };
  const portrait = aspect.h >= aspect.w;

  return (
    <div className="flex items-center justify-center">
      <div
        ref={frameRef}
        className="relative max-h-[62vh] overflow-hidden rounded-lg bg-black ring-1 ring-white/10"
        style={{ ...aspectStyle, [portrait ? "height" : "width"]: portrait ? "62vh" : "100%", maxWidth: "100%" }}
      >
        {!src || !clip ? (
          <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-[var(--muted-foreground)]">
            {src ? "Add a clip to the timeline to preview it." : "Import a video to start."}
          </div>
        ) : (
          <>
            {/* Background fill */}
            {clip.background.type === "blur" ? (
              <SyncedVideo
                primaryRef={videoRef}
                src={src}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: "blur(28px) brightness(0.55)", transform: "scale(1.15)" }}
              />
            ) : (
              <div className="absolute inset-0" style={{ background: clip.background.color }} />
            )}

            {/* Primary source layer */}
            <div
              className="absolute inset-0"
              style={{ transform: `rotate(${framing.rotation}deg)`, transformOrigin: "50% 50%" }}
            >
              <video
                ref={videoRef}
                src={src}
                playsInline
                preload="auto"
                onLoadedMetadata={handleLoaded}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: `${primaryLayer.videoW}px`,
                  height: `${primaryLayer.videoH}px`,
                  transformOrigin: "0 0",
                  transform: `translate(${primaryLayer.tx}px, ${primaryLayer.ty}px) scale(${primaryLayer.scale})`
                }}
              />
            </div>

            {/* Camera overlay layer */}
            {clip.camera.enabled && (
              <CameraLayer primaryRef={videoRef} src={src} frame={frame} dims={dims} camera={clip.camera} />
            )}

            {/* Reframe interaction surface */}
            <div
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            />

            {/* Safe areas (Shorts captions + platform UI) */}
            {showSafeAreas && (
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-[12%] bg-gradient-to-b from-black/40 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 h-[20%] bg-gradient-to-t from-black/45 to-transparent" />
                <div className="absolute inset-[5%] rounded border border-dashed border-white/35" />
                <div className="absolute bottom-[3%] left-1/2 h-[14%] w-[60%] -translate-x-1/2 rounded border border-dashed border-amber-300/50" />
                <span className="absolute bottom-[3.5%] left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wide text-amber-200/70">
                  caption-safe
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
