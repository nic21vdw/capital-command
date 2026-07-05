"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Crop, FileVideo, RotateCw } from "lucide-react";
import { aspectDimensions } from "@/lib/clipping/editor";
import {
  CLIP_LAYOUTS,
  DEFAULT_FACE_SOURCE,
  LAYOUT_MODE_PRESETS,
  withFaceSource,
  type ClipLayoutDefinition,
  type Rect
} from "@/lib/clipping/layouts";
import { cn } from "@/lib/utils";
import type { CaptionStyle, ClipProject, Overlay, ReframeTransform } from "@/types/domain";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2) || "00", 16);
  const g = parseInt(clean.slice(2, 4) || "00", 16);
  const b = parseInt(clean.slice(4, 6) || "00", 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Captions ---------------------------------------------------------------

function captionPositionClasses(style: CaptionStyle): string {
  if (style.position === "top") return "top-[6%] items-start";
  if (style.position === "middle") return "top-1/2 -translate-y-1/2 items-center";
  if (style.position === "lower-third") return "bottom-[18%] items-end";
  return "bottom-[6%] items-end";
}

/**
 * A caption clock that reads the driver video directly at display rate, so
 * word-level highlights stay locked to the voice instead of the coarser
 * editor-wide time updates.
 */
function useCaptionClock(video: HTMLVideoElement | null, fallback: number): number {
  const [t, setT] = useState(fallback);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (video) setT(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video]);
  return video ? t : fallback;
}

function CaptionWordSpan({
  text,
  state,
  style,
  animation
}: {
  text: string;
  state: "spoken" | "active" | "upcoming";
  style: CaptionStyle;
  animation: CaptionStyle["animation"];
}) {
  const highlighted = state === "active" || (animation === "karaoke" && state === "spoken");
  return (
    <span
      className="inline-block whitespace-pre transition-[transform,color,opacity] duration-100 ease-out"
      style={{
        color: highlighted ? style.highlightColor : undefined,
        opacity: animation === "karaoke" && state === "upcoming" ? 0.6 : 1,
        transform: state === "active" && animation !== "none" ? "scale(1.1)" : "scale(1)"
      }}
    >
      {text}
    </span>
  );
}

function CaptionLayer({
  project,
  video,
  fallbackTime,
  frameH
}: {
  project: ClipProject;
  video: HTMLVideoElement | null;
  fallbackTime: number;
  frameH: number;
}) {
  const time = useCaptionClock(video, fallbackTime);
  if (!project.captionsVisible) return null;
  const seg = project.captions.find((s) => s.enabled && time >= s.start && time < s.end);
  if (!seg) return null;
  const style = project.captionStyle;
  const fontSize = Math.max(8, style.fontScale * frameH);
  const align = style.alignment === "left" ? "text-left" : style.alignment === "right" ? "text-right" : "text-center";
  const bg = style.backgroundOpacity > 0.02 ? hexWithAlpha(style.backgroundColor, style.backgroundOpacity) : "transparent";
  const transform = (word: string) => (style.uppercase ? word.toUpperCase() : word);
  const animate = style.animation;

  // Group words into lines of `wordsPerLine` so long phrases wrap predictably.
  const lines: { text: string; state: "spoken" | "active" | "upcoming" }[][] = [];
  if (project.highlightCurrentWord && seg.words.length > 0) {
    let line: { text: string; state: "spoken" | "active" | "upcoming" }[] = [];
    seg.words.forEach((w, i) => {
      const state: "spoken" | "active" | "upcoming" =
        time >= w.start && time < w.end ? "active" : time >= w.end ? "spoken" : "upcoming";
      line.push({ text: transform(w.text) + (i < seg.words.length - 1 ? " " : ""), state });
      if (line.length >= Math.max(1, style.wordsPerLine)) {
        lines.push(line);
        line = [];
      }
    });
    if (line.length) lines.push(line);
  }

  return (
    <div className={cn("pointer-events-none absolute inset-x-0 z-10 flex px-[6%]", captionPositionClasses(style))}>
      <div className={cn("w-full", align)}>
        <span
          key={seg.id}
          className={cn(
            "inline-block rounded-lg px-2 py-0.5 leading-tight",
            animate === "pop" && "animate-[caption-pop_180ms_cubic-bezier(0.2,1.4,0.4,1)_both]",
            animate === "fade" && "animate-[caption-fade_220ms_ease-out_both]"
          )}
          style={{
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            fontSize,
            color: style.textColor,
            background: bg,
            textShadow: `0 ${Math.max(1, style.shadow)}px ${Math.max(2, style.shadow * 2)}px rgba(0,0,0,0.65)`,
            WebkitTextStroke: style.outlineWidth > 0 ? `${style.outlineWidth * 0.45}px #000` : undefined,
            paintOrder: "stroke fill"
          }}
        >
          {lines.length > 0
            ? lines.map((line, li) => (
                <span key={li} className="block">
                  {line.map((w, wi) => (
                    <CaptionWordSpan key={wi} text={w.text} state={w.state} style={style} animation={animate} />
                  ))}
                </span>
              ))
            : transform(seg.text)}
        </span>
      </div>
    </div>
  );
}

// --- Watermark ---------------------------------------------------------------

function WatermarkLayer({ frameH }: { frameH: number }) {
  const fs = Math.max(10, frameH * 0.03);
  const badge = fs * 1.15;
  return (
    <div
      className="pointer-events-none absolute z-10 flex items-center gap-[0.4em]"
      style={{ left: `${frameH * 0.035}px`, bottom: `${frameH * 0.035}px`, opacity: 0.86 }}
    >
      <span
        className="block"
        style={{
          width: badge,
          height: badge,
          borderRadius: badge * 0.28,
          background: "linear-gradient(135deg, #a855f7, #7c3aed)"
        }}
      />
      <span className="font-bold leading-none" style={{ fontSize: fs, color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
        CoLateral AI
      </span>
    </div>
  );
}

// --- Overlays ----------------------------------------------------------------

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
      className="absolute z-20"
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

// --- Video geometry ------------------------------------------------------------

type Box = { left: number; top: number; width: number; height: number };

/**
 * Computes where a source-crop of the video must sit so that the crop region
 * fills `dest` (a pixel rect inside the frame) with the given fit — the same
 * math the ffmpeg export chain applies, so what you see is what renders.
 *
 * Returns the mask (the visible window, centered in dest) and the video box
 * positioned relative to that mask.
 */
function layerGeometry(
  dest: Box,
  crop: Rect,
  videoAspect: number,
  fit: "cover" | "contain"
): { mask: Box; video: Box } {
  const cropW = Math.max(0.01, crop.w);
  const cropH = Math.max(0.01, crop.h);
  // Candidate video display widths that make the crop region match dest
  // horizontally / vertically.
  const byWidth = dest.width / cropW;
  const byHeight = (dest.height / cropH) * videoAspect;
  const vw = fit === "cover" ? Math.max(byWidth, byHeight) : Math.min(byWidth, byHeight);
  const vh = vw / videoAspect;
  const maskW = fit === "cover" ? dest.width : cropW * vw;
  const maskH = fit === "cover" ? dest.height : cropH * vh;
  const mask: Box = {
    left: dest.left + (dest.width - maskW) / 2,
    top: dest.top + (dest.height - maskH) / 2,
    width: maskW,
    height: maskH
  };
  // Center of the crop region aligns with the center of the mask.
  const cropCx = (crop.x + cropW / 2) * vw;
  const cropCy = (crop.y + cropH / 2) * vh;
  const video: Box = {
    left: maskW / 2 - cropCx,
    top: maskH / 2 - cropCy,
    width: vw,
    height: vh
  };
  return { mask, video };
}

/**
 * Geometry for the single-layer reframe modes, mirroring the export chains:
 * - center-blur: contain-fit, then zoom, offset over the spare space
 * - crop-fill:   cover-fit, then zoom, offset over the overflow
 * - fit:         plain contain, centered
 * offsetX/offsetY = -1..1 sweep the full pan range exactly like the export.
 */
function reframeGeometry(
  mode: "center-blur" | "crop-fill" | "fit",
  frameW: number,
  frameH: number,
  videoAspect: number,
  reframe: ReframeTransform
): { mask: Box; video: Box } {
  const frameAspect = frameW / frameH;
  const baseW = mode === "crop-fill" ? (videoAspect >= frameAspect ? frameH * videoAspect : frameW) : videoAspect >= frameAspect ? frameW : frameH * videoAspect;
  const zoom = mode === "fit" ? 1 : Math.max(1, reframe.scale);
  const vw = baseW * zoom;
  const vh = vw / videoAspect;
  const ox = mode === "fit" ? 0 : clamp(reframe.offsetX, -1, 1);
  const oy = mode === "fit" ? 0 : clamp(reframe.offsetY, -1, 1);
  const video: Box = {
    left: ((frameW - vw) / 2) * (1 + ox),
    top: ((frameH - vh) / 2) * (1 + oy),
    width: vw,
    height: vh
  };
  return { mask: { left: 0, top: 0, width: frameW, height: frameH }, video };
}

function boxStyle(box: Box): React.CSSProperties {
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

// --- On-preview crop editing ----------------------------------------------------

type CropHandle = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const CROP_HANDLES: Array<{ id: Exclude<CropHandle, "move">; className: string; cursor: string }> = [
  { id: "nw", className: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
  { id: "n", className: "-top-1.5 left-1/2 -translate-x-1/2", cursor: "ns-resize" },
  { id: "ne", className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
  { id: "e", className: "-right-1.5 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { id: "se", className: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" },
  { id: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2", cursor: "ns-resize" },
  { id: "sw", className: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
  { id: "w", className: "-left-1.5 top-1/2 -translate-y-1/2", cursor: "ew-resize" }
];

const MIN_CROP = 0.08;

/**
 * Draggable crop extents rendered over the full source frame: drag the body to
 * move the region, drag any edge/corner handle to resize it. Values are kept
 * in normalized source coordinates so they translate 1:1 to the export crop.
 */
function CropRectEditor({
  frame,
  rect,
  onChange,
  label
}: {
  /** Pixel box of the full source frame inside the preview. */
  frame: Box;
  rect: Rect;
  onChange: (rect: Rect) => void;
  label: string;
}) {
  const px: Box = {
    left: frame.left + rect.x * frame.width,
    top: frame.top + rect.y * frame.height,
    width: rect.w * frame.width,
    height: rect.h * frame.height
  };

  const begin = (handle: CropHandle) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { ...rect };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / frame.width;
      const dy = (ev.clientY - sy) / frame.height;
      let { x, y, w, h } = start;
      if (handle === "move") {
        x = clamp(start.x + dx, 0, 1 - start.w);
        y = clamp(start.y + dy, 0, 1 - start.h);
      } else {
        if (handle.includes("w")) {
          const right = start.x + start.w;
          x = clamp(start.x + dx, 0, right - MIN_CROP);
          w = right - x;
        }
        if (handle.includes("e")) {
          w = clamp(start.w + dx, MIN_CROP, 1 - start.x);
        }
        if (handle.includes("n")) {
          const bottom = start.y + start.h;
          y = clamp(start.y + dy, 0, bottom - MIN_CROP);
          h = bottom - y;
        }
        if (handle.includes("s")) {
          h = clamp(start.h + dy, MIN_CROP, 1 - start.y);
        }
      }
      onChange({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="absolute inset-0 z-30" onPointerDown={(e) => e.stopPropagation()}>
      {/* Dim everything outside the crop region. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute bg-black/55" style={{ left: 0, top: 0, right: 0, height: Math.max(0, px.top) }} />
        <div className="absolute bg-black/55" style={{ left: 0, top: px.top + px.height, right: 0, bottom: 0 }} />
        <div className="absolute bg-black/55" style={{ left: 0, top: px.top, width: Math.max(0, px.left), height: px.height }} />
        <div className="absolute bg-black/55" style={{ left: px.left + px.width, top: px.top, right: 0, height: px.height }} />
      </div>

      <div
        className="absolute cursor-move rounded-sm border-2 border-[var(--accent)] shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{ ...boxStyle(px), touchAction: "none" }}
        onPointerDown={begin("move")}
      >
        <span className="absolute -top-6 left-0 rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)]">
          {label}
        </span>
        {/* Rule-of-thirds guides while adjusting. */}
        <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/25" />
        <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/25" />
        <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/25" />
        <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/25" />
        {CROP_HANDLES.map((h) => (
          <span
            key={h.id}
            onPointerDown={begin(h.id)}
            className={cn("absolute h-3 w-3 rounded-full border-2 border-white bg-[var(--accent)]", h.className)}
            style={{ cursor: h.cursor, touchAction: "none" }}
          />
        ))}
      </div>
    </div>
  );
}

// --- Preview -------------------------------------------------------------------

export function EditorPreview({
  project,
  time,
  videoSrc,
  onVideoReady,
  onTogglePlay,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayChange,
  onReframeChange,
  faceCropEditing = false,
  onFaceCropEditingChange,
  onFaceSourceChange
}: {
  project: ClipProject;
  time: number;
  videoSrc: string;
  onVideoReady: (el: HTMLVideoElement | null) => void;
  onTogglePlay?: () => void;
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onOverlayChange: (id: string, partial: Partial<Overlay>) => void;
  onReframeChange: (partial: Partial<ReframeTransform>) => void;
  faceCropEditing?: boolean;
  onFaceCropEditingChange?: (v: boolean) => void;
  onFaceSourceChange?: (rect: Rect) => void;
}) {
  const dims = aspectDimensions(project.aspectRatio);
  const fgRef = useRef<HTMLVideoElement>(null);
  const faceRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ w: 360, h: 640 });
  const [videoAspect, setVideoAspect] = useState(project.baseWidth / Math.max(1, project.baseHeight));
  const [fgVideo, setFgVideo] = useState<HTMLVideoElement | null>(null);
  // Keyed by src so a clip switch automatically clears a previous failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loadFailed = failedSrc === videoSrc;

  const layoutPreset = LAYOUT_MODE_PRESETS[project.compositionMode];
  const layout: ClipLayoutDefinition | null = layoutPreset
    ? withFaceSource(CLIP_LAYOUTS[layoutPreset], project.faceSource ?? DEFAULT_FACE_SOURCE)
    : null;
  const hasFaceLayer = Boolean(layout?.layers.some((l) => l.kind === "face"));
  const croppingFace = faceCropEditing && hasFaceLayer && Boolean(onFaceSourceChange);
  const isFit = project.compositionMode === "fit";
  const canPan = !croppingFace && (project.compositionMode === "center-blur" || project.compositionMode === "crop-fill");

  // Measure the rendered frame so all geometry is pixel-accurate.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [project.aspectRatio]);

  // Expose the driver video to the parent transport, and — critically — pause
  // all media on unmount. A removed <video> that is still playing keeps its
  // audio alive, which is how switching clips used to leak the previous clip's
  // soundtrack over the next one. (Pause only: clearing `src` here would fight
  // React's attribute reconciliation and leave the element permanently empty
  // after StrictMode's dev double-mount.)
  useEffect(() => {
    onVideoReady(fgRef.current);
    setFgVideo(fgRef.current);
    const media = [fgRef.current, faceRef.current, bgRef.current];
    return () => {
      onVideoReady(null);
      for (const el of media) el?.pause();
    };
  }, [onVideoReady]);

  // Followers (blur fill + face layer) chase the driver every frame so the
  // background blur and the camera crop always move with the voice.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const fg = fgRef.current;
      if (fg) {
        for (const follower of [bgRef.current, faceRef.current]) {
          if (!follower || !follower.src) continue;
          const active = follower === bgRef.current ? !isFit : hasFaceLayer;
          if (!active) {
            if (!follower.paused) follower.pause();
            continue;
          }
          if (Math.abs(follower.currentTime - fg.currentTime) > 0.15) follower.currentTime = fg.currentTime;
          if (fg.paused && !follower.paused) follower.pause();
          else if (!fg.paused && follower.paused) void follower.play().catch(() => undefined);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isFit, hasFaceLayer]);

  const frameW = frameSize.w;
  const frameH = frameSize.h;

  // --- Geometry: identical math to the ffmpeg export chains. ---
  // Plain computation (cheap arithmetic) — memoizing on `layout` would be
  // pointless since its identity changes with every project edit.
  const geometry = (() => {
    // While the face crop is being adjusted, show the whole source frame so
    // the user can see (and drag) exactly what the camera crop captures.
    if (croppingFace) {
      return {
        screen: reframeGeometry("fit", frameW, frameH, videoAspect, { scale: 1, offsetX: 0, offsetY: 0 }),
        face: null
      };
    }
    const screenLayer = layout?.layers.find((l) => l.kind === "screen");
    const faceLayer = layout?.layers.find((l) => l.kind === "face");
    const toPx = (rect: Rect): Box => ({
      left: rect.x * frameW,
      top: rect.y * frameH,
      width: rect.w * frameW,
      height: rect.h * frameH
    });
    if (layout && screenLayer) {
      return {
        screen: layerGeometry(toPx(screenLayer.dest), screenLayer.source, videoAspect, screenLayer.fit ?? "contain"),
        face: faceLayer ? layerGeometry(toPx(faceLayer.dest), faceLayer.source, videoAspect, faceLayer.fit ?? "cover") : null
      };
    }
    const mode = isFit ? "fit" : project.compositionMode === "crop-fill" ? "crop-fill" : "center-blur";
    return { screen: reframeGeometry(mode, frameW, frameH, videoAspect, project.reframe), face: null };
  })();

  // Pan by dragging — active in the reframe modes only, sweeping the exact
  // export pan range. A still click (no movement) toggles playback instead.
  const beginPointer = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onSelectOverlay(null);
    const sx = e.clientX;
    const sy = e.clientY;
    const startX = project.reframe.offsetX;
    const startY = project.reframe.offsetY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
      if (!moved || !canPan) return;
      // Convert pixels into the -1..1 offset domain of the spare space. The
      // divisor keeps its sign so the content always follows the pointer,
      // whether the video overflows the frame (crop) or floats inside it.
      const spareX = (frameW - geometry.screen.video.width) / 2;
      const spareY = (frameH - geometry.screen.video.height) / 2;
      const dx = Math.abs(spareX) > 1 ? (ev.clientX - sx) / spareX : 0;
      const dy = Math.abs(spareY) > 1 ? (ev.clientY - sy) / spareY : 0;
      onReframeChange({ offsetX: clamp(startX + dx, -1, 1), offsetY: clamp(startY + dy, -1, 1) });
    };
    const up = () => {
      if (!moved) onTogglePlay?.();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const visibleOverlays = [...project.overlays]
    .filter((o) => time >= o.start && (o.end <= o.start || time <= o.end))
    .sort((a, b) => a.z - b.z);

  const sharedVideoProps = {
    src: videoSrc,
    playsInline: true,
    preload: "auto" as const
  };

  return (
    <div className="flex items-center justify-center">
      <div
        ref={frameRef}
        className={cn(
          "relative overflow-hidden rounded-2xl bg-black shadow-[0_18px_48px_-12px_rgba(0,0,0,0.55)] ring-1 ring-white/10",
          canPan && "cursor-grab active:cursor-grabbing"
        )}
        style={{
          aspectRatio: `${dims.w} / ${dims.h}`,
          width: dims.w >= dims.h ? "min(100%, 720px)" : "auto",
          height: dims.w >= dims.h ? "auto" : "min(62vh, 780px)"
        }}
        onPointerDown={beginPointer}
        onDoubleClick={() => canPan && onReframeChange({ offsetX: 0, offsetY: 0 })}
        title={canPan ? "Drag to pan - double-click to center" : undefined}
      >
        {/* Blurred fill behind everything (mirrors the export's blur base). */}
        <video
          ref={bgRef}
          {...sharedVideoProps}
          muted
          aria-hidden
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            isFit ? "opacity-0" : "opacity-100"
          )}
          style={{ filter: "blur(22px) brightness(0.55)", transform: "scale(1.12)" }}
        />

        {/* Screen / main layer. The driver video lives here permanently so
            switching layouts never remounts it (remounting resets playback
            and used to freeze the preview). */}
        <div className="absolute overflow-hidden transition-all duration-300 ease-out" style={boxStyle(geometry.screen.mask)}>
          <video
            ref={fgRef}
            {...sharedVideoProps}
            onError={() => setFailedSrc(videoSrc)}
            onLoadedData={() => setFailedSrc(null)}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (el.videoWidth > 0 && el.videoHeight > 0) setVideoAspect(el.videoWidth / el.videoHeight);
            }}
            className="absolute max-w-none"
            style={boxStyle(geometry.screen.video)}
          />
        </div>

        {/* Face-camera layer (muted follower), only shown by split layouts. */}
        <div
          className={cn(
            "absolute overflow-hidden rounded-sm transition-all duration-300 ease-out",
            geometry.face ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          style={geometry.face ? boxStyle(geometry.face.mask) : { left: 0, top: 0, width: 0, height: 0 }}
        >
          <video ref={faceRef} {...sharedVideoProps} muted aria-hidden className="absolute max-w-none" style={geometry.face ? boxStyle(geometry.face.video) : undefined} />
        </div>

        {/* Clear, actionable state when the clip's video can't be loaded. */}
        {loadFailed && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center">
            <FileVideo className="h-7 w-7 text-[var(--accent)]" />
            <p className="text-sm font-semibold text-white">This clip&apos;s video isn&apos;t available</p>
            <p className="max-w-xs text-xs text-[var(--muted-foreground)]">
              The rendered file couldn&apos;t be loaded — it may have been removed from the server or the render never
              finished. Re-render the clip in the Clip Generator, then start a new project. Captions, overlays, and
              export settings on this project are still saved.
            </p>
          </div>
        )}

        {/* Safe-area guide. */}
        {!croppingFace && <div className="pointer-events-none absolute inset-[5%] z-10 rounded-md border border-dashed border-white/15" />}

        {!croppingFace &&
          visibleOverlays.map((overlay) => (
            <OverlayItem
              key={overlay.id}
              overlay={overlay}
              selected={overlay.id === selectedOverlayId}
              frame={{ w: frameW, h: frameH }}
              onSelect={() => onSelectOverlay(overlay.id)}
              onChange={(partial) => onOverlayChange(overlay.id, partial)}
            />
          ))}

        {!croppingFace && <CaptionLayer project={project} video={fgVideo} fallbackTime={time} frameH={frameH} />}

        {!croppingFace && project.exportSettings.watermark && <WatermarkLayer frameH={frameH} />}

        {/* Drag-to-adjust face-camera crop, right on the preview. */}
        {croppingFace && onFaceSourceChange && (
          <CropRectEditor
            frame={geometry.screen.video}
            rect={project.faceSource ?? DEFAULT_FACE_SOURCE}
            onChange={onFaceSourceChange}
            label="Face camera"
          />
        )}

        {/* Face-crop mode toggle, shown whenever the layout uses a camera crop. */}
        {hasFaceLayer && onFaceCropEditingChange && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFaceCropEditingChange(!croppingFace);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "absolute right-2 top-2 z-40 flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium backdrop-blur transition-all duration-200",
              croppingFace
                ? "border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] shadow-lg"
                : "border-white/15 bg-black/55 text-white/85 hover:bg-black/75 hover:text-white"
            )}
          >
            {croppingFace ? (
              <>
                <Check className="h-3.5 w-3.5" /> Done
              </>
            ) : (
              <>
                <Crop className="h-3.5 w-3.5" /> Adjust face crop
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
