"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  Layers,
  Loader2,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  Type,
  X
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aspectSpec, COLATERAL_THEME, loadImage, renderSlideCanvas } from "@/lib/carousels/render";
import { cn } from "@/lib/utils";
import type { Carousel, CarouselAspectRatio, CarouselSlide, SlideLayer } from "@/types/domain";

type Mode = "preview" | "edit";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`);

/**
 * Full-screen slide viewer + editor. Preview mode blows the current slide up
 * with iOS spring motion and lets you swipe/arrow between slides; Edit mode
 * turns the stage into a compositor — drag text and image layers, recolor the
 * background, and rewrite the base copy — then Save persists the whole deck.
 */
export function SlideEditor({
  slides,
  ratio,
  index: initialIndex,
  mode: initialMode,
  sourceType,
  sourceId,
  onSave,
  onClose,
  saving
}: {
  slides: CarouselSlide[];
  ratio: CarouselAspectRatio;
  index: number;
  mode: Mode;
  sourceType: Carousel["sourceType"];
  sourceId?: string;
  onSave: (slides: CarouselSlide[]) => void | Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [index, setIndex] = useState(initialIndex);
  const [draft, setDraft] = useState<CarouselSlide[]>(slides);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const total = draft.length;
  const slide = draft[index];
  const spec = aspectSpec(ratio);

  const go = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(total - 1, next)));
      setSelectedLayer(null);
    },
    [total]
  );

  // Escape closes; arrows page in preview mode.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (mode === "preview") {
        if (event.key === "ArrowLeft") go(index - 1);
        if (event.key === "ArrowRight") go(index + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, index, go, onClose]);

  const patchSlide = useCallback(
    (updater: (slide: CarouselSlide) => CarouselSlide) => {
      setDraft((current) => current.map((entry, i) => (i === index ? updater(entry) : entry)));
      setDirty(true);
    },
    [index]
  );

  const updateLayer = useCallback(
    (layerId: string, patch: Partial<SlideLayer>) => {
      patchSlide((entry) => ({
        ...entry,
        layers: (entry.layers ?? []).map((layer) => (layer.id === layerId ? ({ ...layer, ...patch } as SlideLayer) : layer))
      }));
    },
    [patchSlide]
  );

  const addTextLayer = () => {
    const layer: SlideLayer = {
      id: uid(),
      type: "text",
      text: "New text",
      x: 0.12,
      y: 0.12,
      width: 0.6,
      fontSize: 0.06,
      color: COLATERAL_THEME.heading,
      weight: 700,
      align: "left"
    };
    patchSlide((entry) => ({ ...entry, layers: [...(entry.layers ?? []), layer] }));
    setSelectedLayer(layer.id);
  };

  /**
   * Drops an image onto the stage. Sizes the box to the image's natural aspect
   * ratio (so nothing is stretched or cropped on arrival — like any image
   * editor) and centers it on `pos` when dropped, else near the top-left.
   */
  const addImageLayer = useCallback(
    async (src: string, pos?: { x: number; y: number }, layout: "free" | "full-bleed" = "free") => {
      const fullBleed = layout === "full-bleed";
      const img = await loadImage(src).catch(() => null);
      let width = fullBleed ? 1 : 0.5;
      let height = fullBleed ? 1 : 0.35;
      if (!fullBleed && img && img.width > 0 && img.height > 0) {
        const boxWpx = width * spec.width;
        const boxHpx = boxWpx * (img.height / img.width);
        height = boxHpx / spec.height;
        if (height > 0.8) {
          height = 0.8;
          width = ((height * spec.height) * (img.width / img.height)) / spec.width;
        }
      }
      const x = fullBleed ? 0 : clamp01((pos?.x ?? 0.25) - width / 2);
      const y = fullBleed ? 0 : clamp01((pos?.y ?? 0.25) - height / 2);
      const layer: SlideLayer = {
        id: uid(),
        type: "image",
        src,
        x,
        y,
        width,
        height,
        radius: fullBleed ? 0 : 0.02,
        fit: fullBleed ? "cover" : "contain",
        layout,
        scale: fullBleed ? 1 : undefined,
        focusX: fullBleed ? 0.5 : undefined,
        focusY: fullBleed ? 0.5 : undefined,
        darken: fullBleed ? 0.38 : undefined,
        opacity: 1
      };
      patchSlide((entry) => {
        const existing = fullBleed
          ? (entry.layers ?? []).filter((item) => item.type !== "image" || item.layout !== "full-bleed")
          : (entry.layers ?? []);
        return {
          ...entry,
          headingColor: fullBleed ? "#ffffff" : entry.headingColor,
          bodyColor: fullBleed ? "rgba(255,255,255,0.86)" : entry.bodyColor,
          layers: fullBleed ? [layer, ...existing] : [...existing, layer]
        };
      });
      setSelectedLayer(layer.id);
    },
    [patchSlide, spec.width, spec.height]
  );

  const removeLayer = (layerId: string) => {
    patchSlide((entry) => ({ ...entry, layers: (entry.layers ?? []).filter((layer) => layer.id !== layerId) }));
    setSelectedLayer(null);
  };

  // Push the current slide's background onto every slide in the deck.
  const applyBackgroundToAll = useCallback(() => {
    const background = draft[index]?.background;
    setDraft((current) => current.map((entry) => ({ ...entry, background })));
    setDirty(true);
    toast.success(background ? "Background applied to all slides." : "Reset the background on all slides.");
  }, [draft, index]);

  const handleSave = async () => {
    await onSave(draft);
    setDirty(false);
  };

  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved edits to this carousel?")) return;
    onClose();
  };

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-md"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                mode === "preview" ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                mode === "edit" ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          </div>
          <span className="hidden text-xs text-[var(--muted-foreground)] sm:inline">
            Slide {index + 1} / {total} · {spec.label} {spec.badge}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {mode === "edit" ? (
            <Button className="gap-1.5 px-3 py-1.5 text-xs" disabled={saving || !dirty} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
          ) : null}
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Stage + (edit) inspector */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4 sm:flex-row sm:px-6 sm:pb-6">
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {mode === "preview" ? (
            <PreviewStage slides={draft} index={index} ratio={ratio} onNavigate={go} />
          ) : (
            <EditStage
              key={slide?.id}
              slide={slide}
              index={index}
              total={total}
              ratio={ratio}
              selectedLayer={selectedLayer}
              onSelectLayer={setSelectedLayer}
              onUpdateLayer={updateLayer}
              onAddImage={addImageLayer}
            />
          )}
        </div>

        {mode === "edit" && slide ? (
          <Inspector
            slide={slide}
            selectedLayer={selectedLayer}
            onPatchSlide={patchSlide}
            onUpdateLayer={updateLayer}
            onRemoveLayer={removeLayer}
            onAddText={addTextLayer}
            onAddImage={addImageLayer}
            onApplyBackgroundToAll={applyBackgroundToAll}
            ratio={ratio}
            sourceType={sourceType}
            sourceId={sourceId}
          />
        ) : null}
      </div>

      {/* Filmstrip */}
      <div className="flex items-center justify-center gap-2 px-4 pb-4">
        {draft.map((entry, i) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => go(i)}
            aria-label={`Slide ${i + 1}`}
            className={cn(
              "h-2 rounded-full transition-all",
              i === index ? "w-6 bg-[var(--accent)]" : "w-2 bg-white/25 hover:bg-white/50"
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Preview: renders the exact export canvas with spring transitions + swipe. */
function PreviewStage({
  slides,
  index,
  ratio,
  onNavigate
}: {
  slides: CarouselSlide[];
  index: number;
  ratio: CarouselAspectRatio;
  onNavigate: (next: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Which slide index has finished painting — drives the fade-in without a
  // synchronous setState in the effect body.
  const [readyIndex, setReadyIndex] = useState<number | null>(null);
  const ready = readyIndex === index;
  const spec = aspectSpec(ratio);
  const swipeStart = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void renderSlideCanvas(slides[index], index, slides.length, ratio).then((canvas) => {
      if (cancelled) return;
      const target = canvasRef.current;
      if (!target) return;
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext("2d")?.drawImage(canvas, 0, 0);
      setReadyIndex(index);
    });
    return () => {
      cancelled = true;
    };
  }, [slides, index, ratio]);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {index > 0 ? (
        <button
          type="button"
          onClick={() => onNavigate(index - 1)}
          aria-label="Previous slide"
          className="absolute left-1 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/70 sm:left-3"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      ) : null}
      <canvas
        key={index}
        ref={canvasRef}
        className={cn(
          "modal-panel-enter max-h-full max-w-full rounded-2xl border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.6)] transition-opacity duration-200",
          ready ? "opacity-100" : "opacity-0"
        )}
        style={{ aspectRatio: `${spec.width} / ${spec.height}` }}
        onPointerDown={(event) => {
          swipeStart.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (swipeStart.current === null) return;
          const delta = event.clientX - swipeStart.current;
          swipeStart.current = null;
          if (delta < -60) onNavigate(index + 1);
          else if (delta > 60) onNavigate(index - 1);
        }}
      />
      {index < slides.length - 1 ? (
        <button
          type="button"
          onClick={() => onNavigate(index + 1)}
          aria-label="Next slide"
          className="absolute right-1 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/70 sm:right-3"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      ) : null}
    </div>
  );
}

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const CORNER_POS: Record<Corner, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"
};

/**
 * Edit: a stack of canvases (background at the bottom, base chrome above the
 * image layers) with the image + text layers as interactive DOM elements — so
 * they can be dragged, scaled with corner handles, and dropped in from the OS,
 * just like any image editor. Z-order matches the export exactly: background →
 * images → base chrome → text.
 */
function EditStage({
  slide,
  index,
  total,
  ratio,
  selectedLayer,
  onSelectLayer,
  onUpdateLayer,
  onAddImage
}: {
  slide: CarouselSlide;
  index: number;
  total: number;
  ratio: CarouselAspectRatio;
  selectedLayer: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, patch: Partial<SlideLayer>) => void;
  onAddImage: (src: string, pos?: { x: number; y: number }) => void;
}) {
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const chromeRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const spec = aspectSpec(ratio);

  // Background canvas — repaints when the background changes.
  useEffect(() => {
    let cancelled = false;
    void renderSlideCanvas(slide, index, total, ratio, {
      skipImageLayers: true,
      skipTextLayers: true,
      skipBaseText: true
    }).then((canvas) => {
      if (cancelled) return;
      const target = bgRef.current;
      if (!target) return;
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext("2d")?.drawImage(canvas, 0, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [slide.background, slide, index, total, ratio]);

  // Base-chrome canvas (transparent) — sits above image layers, below text.
  const chromeDeps = JSON.stringify({
    hc: slide.headingColor,
    bc: slide.bodyColor,
    h: slide.heading,
    b: slide.body,
    hide: slide.hideBaseText
  });
  useEffect(() => {
    let cancelled = false;
    void renderSlideCanvas(slide, index, total, ratio, {
      skipBackground: true,
      skipImageLayers: true,
      skipTextLayers: true
    }).then((canvas) => {
      if (cancelled) return;
      const target = chromeRef.current;
      if (!target) return;
      target.width = canvas.width;
      target.height = canvas.height;
      const ctx = target.getContext("2d");
      ctx?.clearRect(0, 0, target.width, target.height);
      ctx?.drawImage(canvas, 0, 0);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chromeDeps, index, total, ratio]);

  const layers = slide.layers ?? [];
  const imageLayers = layers.filter((l): l is Extract<SlideLayer, { type: "image" }> => l.type === "image");
  const textLayers = layers.filter((l): l is Extract<SlideLayer, { type: "text" }> => l.type === "text");

  // Drag the whole layer: convert pixel deltas to slide fractions.
  const startMove = (event: React.PointerEvent, layer: SlideLayer) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(layer.id);
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = layer.x;
    const originY = layer.y;
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / rect.width;
      const dy = (moveEvent.clientY - startY) / rect.height;
      onUpdateLayer(layer.id, { x: clamp01(originX + dx), y: clamp01(originY + dy) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Corner-handle resize. Images scale their box freely; text scales its width
  // and font size together (its height is derived from content).
  const startResize = (event: React.PointerEvent, layer: SlideLayer, corner: Corner) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(layer.id);
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const west = corner === "nw" || corner === "sw";
    const north = corner === "nw" || corner === "ne";
    const origin = { x: layer.x, y: layer.y };

    if (layer.type === "image") {
      const w0 = layer.width;
      const h0 = layer.height;
      const move = (moveEvent: PointerEvent) => {
        const dx = (moveEvent.clientX - startX) / rect.width;
        const dy = (moveEvent.clientY - startY) / rect.height;
        const width = Math.max(0.05, west ? w0 - dx : w0 + dx);
        const height = Math.max(0.05, north ? h0 - dy : h0 + dy);
        const x = west ? origin.x + (w0 - width) : origin.x;
        const y = north ? origin.y + (h0 - height) : origin.y;
        onUpdateLayer(layer.id, { width, height, x: clamp01(x), y: clamp01(y) });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    // Text: horizontal drag drives width + a proportional font-size scale.
    const w0 = layer.width;
    const font0 = layer.fontSize;
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / rect.width;
      const width = Math.max(0.1, Math.min(1, west ? w0 - dx : w0 + dx));
      const scale = width / w0;
      const fontSize = Math.max(0.02, Math.min(0.2, font0 * scale));
      const x = west ? clamp01(origin.x + (w0 - width)) : origin.x;
      onUpdateLayer(layer.id, { width, fontSize, x });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    const rect = stageRef.current?.getBoundingClientRect();
    const pos = rect
      ? { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) }
      : undefined;
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      if (event.dataTransfer.files.length) toast.error("Drop an image file (PNG, JPG…).");
      return;
    }
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" && onAddImage(reader.result, pos);
      reader.readAsDataURL(file);
    });
  };

  const cornerHandles = (layer: SlideLayer) =>
    CORNERS.map((corner) => (
      <span
        key={corner}
        onPointerDown={(event) => startResize(event, layer, corner)}
        className={cn("absolute z-10 h-3 w-3 touch-none rounded-sm border border-[var(--accent)] bg-white shadow", CORNER_POS[corner])}
      />
    ));

  return (
    <div
      ref={stageRef}
      className={cn(
        "modal-panel-enter relative max-h-full overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.6)]",
        dropActive ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/60" : "border-white/10"
      )}
      style={{ aspectRatio: `${spec.width} / ${spec.height}`, height: "min(72vh, 100%)" }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget || event.target === bgRef.current || event.target === chromeRef.current) {
          onSelectLayer(null);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.target === event.currentTarget) setDropActive(false);
      }}
      onDrop={handleDrop}
    >
      <canvas ref={bgRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Image layers: interactive, between background and base chrome. */}
      {imageLayers.map((layer) => {
        const fullBleed = layer.layout === "full-bleed";
        const focusX = layer.focusX ?? 0.5;
        const focusY = layer.focusY ?? 0.5;
        return (
          <div
            key={layer.id}
            onPointerDown={(event) => (fullBleed ? (event.stopPropagation(), onSelectLayer(layer.id)) : startMove(event, layer))}
            className={cn(
              "absolute touch-none select-none overflow-hidden",
              fullBleed ? "cursor-default" : "cursor-move",
              selectedLayer === layer.id
                ? "outline outline-2 outline-[var(--accent)]"
                : "outline-dashed outline-1 outline-white/30 hover:outline-white/60"
            )}
            style={{
              left: fullBleed ? 0 : `${layer.x * 100}%`,
              top: fullBleed ? 0 : `${layer.y * 100}%`,
              width: fullBleed ? "100%" : `${layer.width * 100}%`,
              height: fullBleed ? "100%" : `${layer.height * 100}%`,
              transform: !fullBleed && layer.rotation ? `rotate(${layer.rotation}deg)` : undefined
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={layer.src}
              alt=""
              draggable={false}
              className="h-full w-full"
              style={{
                objectFit: fullBleed ? "cover" : (layer.fit ?? "contain"),
                objectPosition: fullBleed ? `${focusX * 100}% ${focusY * 100}%` : undefined,
                transform: fullBleed ? `scale(${layer.scale ?? 1})` : undefined,
                transformOrigin: fullBleed ? `${focusX * 100}% ${focusY * 100}%` : undefined,
                opacity: layer.opacity ?? 1,
                borderRadius: fullBleed ? 0 : `${Math.min(50, (layer.radius ?? 0) * 100)}%`
              }}
            />
            {fullBleed && (layer.darken ?? 0) > 0 ? (
              <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: layer.darken ?? 0 }} />
            ) : null}
            {selectedLayer === layer.id && !fullBleed ? cornerHandles(layer) : null}
          </div>
        );
      })}

      {/* Base chrome sits above images, below text — pointer-transparent. */}
      <canvas ref={chromeRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Text layers on top. */}
      {textLayers.map((layer) => (
        <div
          key={layer.id}
          onPointerDown={(event) => startMove(event, layer)}
          className={cn(
            "absolute cursor-move touch-none select-none",
            selectedLayer === layer.id ? "outline outline-2 outline-[var(--accent)]" : "outline-dashed outline-1 outline-white/20 hover:outline-white/50"
          )}
          style={{
            left: `${layer.x * 100}%`,
            top: `${layer.y * 100}%`,
            width: `${layer.width * 100}%`,
            color: layer.color,
            fontWeight: layer.weight,
            fontSize: `calc(${layer.fontSize} * min(72vh, 100%))`,
            lineHeight: 1.18,
            textAlign: layer.align,
            transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
            fontFamily: "system-ui, -apple-system, sans-serif"
          }}
        >
          {layer.text || " "}
          {selectedLayer === layer.id ? cornerHandles(layer) : null}
        </div>
      ))}

      {dropActive ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--accent)]/10 text-sm font-medium text-white">
          Drop image to add it
        </div>
      ) : null}
    </div>
  );
}

/** Right-hand controls: background, base copy, and selected-layer properties. */
function Inspector({
  slide,
  selectedLayer,
  onPatchSlide,
  onUpdateLayer,
  onRemoveLayer,
  onAddText,
  onAddImage,
  onApplyBackgroundToAll,
  ratio,
  sourceType,
  sourceId
}: {
  slide: CarouselSlide;
  selectedLayer: string | null;
  onPatchSlide: (updater: (slide: CarouselSlide) => CarouselSlide) => void;
  onUpdateLayer: (id: string, patch: Partial<SlideLayer>) => void;
  onRemoveLayer: (id: string) => void;
  onAddText: () => void;
  onAddImage: (src: string, pos?: { x: number; y: number }, layout?: "free" | "full-bleed") => void;
  onApplyBackgroundToAll: () => void;
  ratio: CarouselAspectRatio;
  sourceType: Carousel["sourceType"];
  sourceId?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [mediaPrompt, setMediaPrompt] = useState([slide.heading, slide.body].filter(Boolean).join(". "));
  const [mediaBusy, setMediaBusy] = useState<"ai" | "frames" | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const layer = (slide.layers ?? []).find((entry) => entry.id === selectedLayer) ?? null;
  const hasStreamSource = Boolean(sourceId && (sourceType === "longform" || sourceType === "short"));

  useEffect(() => {
    setMediaPrompt([slide.heading, slide.body].filter(Boolean).join(". "));
    setFrames([]);
  }, [slide.id, slide.heading, slide.body]);

  const placeFullBleed = (src: string) => onAddImage(src, undefined, "full-bleed");

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Drop an image file (PNG, JPG…).");
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && placeFullBleed(reader.result);
    reader.readAsDataURL(file);
  };

  const generateImage = async () => {
    if (!mediaPrompt.trim()) return void toast.error("Give the image a short visual direction first.");
    setMediaBusy("ai");
    try {
      const response = await fetch("/api/studio/carousels/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: mediaPrompt, ratio })
      });
      const json = (await response.json()) as { src?: string; error?: string };
      if (!response.ok || !json.src) throw new Error(json.error || "Image generation failed.");
      placeFullBleed(json.src);
      toast.success("Image generated and fitted to the slide.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the image.");
    } finally {
      setMediaBusy(null);
    }
  };

  const loadFrames = async () => {
    if (!hasStreamSource) return void toast.error("This carousel is not linked to a stream or short-form video.");
    setMediaBusy("frames");
    try {
      const response = await fetch("/api/studio/carousels/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, sourceId, count: 8 })
      });
      const json = (await response.json()) as { frames?: string[]; error?: string };
      if (!response.ok || !json.frames?.length) throw new Error(json.error || "No stream frames were found.");
      setFrames(json.frames);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read stream frames.");
    } finally {
      setMediaBusy(null);
    }
  };

  return (
    <div className="panel-enter flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:w-80">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          onPickImage(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-white/5 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Image source</p>
        <textarea
          value={mediaPrompt}
          onChange={(event) => setMediaPrompt(event.target.value)}
          rows={3}
          placeholder="Describe a realistic visual for this slide…"
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
        />
        <Button className="w-full gap-1.5 px-2 py-2 text-xs" disabled={mediaBusy !== null} onClick={() => void generateImage()}>
          {mediaBusy === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Generate with AI
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            className="gap-1.5 px-2 py-2 text-xs"
            disabled={!hasStreamSource || mediaBusy !== null}
            onClick={() => void loadFrames()}
          >
            {mediaBusy === "frames" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Stream frames
          </Button>
          <Button variant="secondary" className="gap-1.5 px-2 py-2 text-xs" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" /> Upload
          </Button>
        </div>
        {frames.length ? (
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {frames.map((src, frameIndex) => (
              <button
                key={src}
                type="button"
                onClick={() => placeFullBleed(src)}
                className="group aspect-video overflow-hidden rounded-md border border-[var(--border)] transition hover:border-[var(--accent)]"
                aria-label={`Use stream frame ${frameIndex + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Button variant="secondary" className="w-full gap-1.5 px-2 py-2 text-xs" onClick={onAddText}>
        <Type className="h-3.5 w-3.5" /> Add text layer
      </Button>

      {layer ? (
        <LayerControls layer={layer} onUpdate={(patch) => onUpdateLayer(layer.id, patch)} onRemove={() => onRemoveLayer(layer.id)} />
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-center text-[11px] text-[var(--muted-foreground)]">
          Generate, choose, or upload an image, then select it on the stage to adjust layout and scale.
        </p>
      )}

      <div className="space-y-2 border-t border-[var(--border)] pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Slide</p>

        <label className="flex items-center justify-between text-xs text-white">
          Background
          <span className="flex items-center gap-1.5">
            <ColorInput
              value={slide.background ?? "#ffffff"}
              onChange={(value) => onPatchSlide((entry) => ({ ...entry, background: value }))}
            />
            {slide.background ? (
              <button
                type="button"
                onClick={() => onPatchSlide((entry) => ({ ...entry, background: undefined }))}
                className="text-[10px] text-[var(--muted-foreground)] underline hover:text-white"
              >
                reset
              </button>
            ) : null}
          </span>
        </label>
        <button
          type="button"
          onClick={onApplyBackgroundToAll}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-white/5 px-2 py-1.5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)]/50 hover:text-white"
        >
          <Layers className="h-3.5 w-3.5" /> Apply background to all slides
        </button>

        <label className="flex items-center justify-between gap-2 text-xs text-white">
          Show base text
          <input
            type="checkbox"
            checked={!slide.hideBaseText}
            onChange={(event) => onPatchSlide((entry) => ({ ...entry, hideBaseText: !event.target.checked }))}
            className="h-4 w-4 accent-[var(--accent)]"
          />
        </label>

        {!slide.hideBaseText ? (
          <>
            <FieldLabel>Heading</FieldLabel>
            <textarea
              value={slide.heading}
              onChange={(event) => onPatchSlide((entry) => ({ ...entry, heading: event.target.value }))}
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
            />
            <FieldLabel>Body</FieldLabel>
            <textarea
              value={slide.body}
              onChange={(event) => onPatchSlide((entry) => ({ ...entry, body: event.target.value }))}
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
            />
            <div className="flex items-center justify-between text-xs text-white">
              Heading color
              <ColorInput value={slide.headingColor ?? COLATERAL_THEME.heading} onChange={(value) => onPatchSlide((entry) => ({ ...entry, headingColor: value }))} />
            </div>
            <div className="flex items-center justify-between text-xs text-white">
              Body color
              <ColorInput value={slide.bodyColor ?? COLATERAL_THEME.body} onChange={(value) => onPatchSlide((entry) => ({ ...entry, bodyColor: value }))} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function LayerControls({
  layer,
  onUpdate,
  onRemove
}: {
  layer: SlideLayer;
  onUpdate: (patch: Partial<SlideLayer>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {layer.type === "text" ? "Text layer" : "Image layer"}
        </p>
        <button type="button" onClick={onRemove} aria-label="Delete layer" className="text-[var(--muted-foreground)] transition hover:text-red-300">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {layer.type === "text" ? (
        <>
          <textarea
            value={layer.text}
            onChange={(event) => onUpdate({ text: event.target.value })}
            rows={2}
            className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
          />
          <Slider label="Size" min={0.02} max={0.16} step={0.005} value={layer.fontSize} onChange={(value) => onUpdate({ fontSize: value })} />
          <Slider label="Width" min={0.2} max={1} step={0.02} value={layer.width} onChange={(value) => onUpdate({ width: value })} />
          <div className="flex items-center justify-between text-xs text-white">
            Color
            <ColorInput value={layer.color} onChange={(value) => onUpdate({ color: value })} />
          </div>
          <div className="flex items-center gap-1">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() => onUpdate({ align })}
                className={cn(
                  "flex-1 rounded-md px-1 py-1 text-[10px] capitalize transition",
                  layer.align === align ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-white/5 text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {align}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {[400, 600, 800].map((weight) => (
              <button
                key={weight}
                type="button"
                onClick={() => onUpdate({ weight })}
                className={cn(
                  "flex-1 rounded-md px-1 py-1 text-[10px] transition",
                  layer.weight === weight ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-white/5 text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {weight === 400 ? "Regular" : weight === 600 ? "Medium" : "Bold"}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1">
            {(["free", "full-bleed"] as const).map((layout) => (
              <button
                key={layout}
                type="button"
                onClick={() =>
                  layout === "full-bleed"
                    ? onUpdate({ layout, x: 0, y: 0, width: 1, height: 1, radius: 0, fit: "cover", scale: 1, focusX: 0.5, focusY: 0.5, darken: 0.38 })
                    : onUpdate({ layout, x: 0.1, y: 0.1, width: 0.8, height: 0.5, fit: "contain", scale: undefined, focusX: undefined, focusY: undefined, darken: undefined })
                }
                className={cn(
                  "rounded-md px-1 py-1.5 text-[10px] transition",
                  (layer.layout ?? "free") === layout
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                    : "bg-white/5 text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {layout === "free" ? "Color + image" : "Full bleed"}
              </button>
            ))}
          </div>
          {layer.layout === "full-bleed" ? (
            <>
              <Slider label="Scale" min={1} max={2.5} step={0.02} value={layer.scale ?? 1} onChange={(value) => onUpdate({ scale: value })} />
              <Slider label="Darken" min={0} max={0.8} step={0.02} value={layer.darken ?? 0.38} onChange={(value) => onUpdate({ darken: value })} />
              <Slider label="Position X" min={0} max={1} step={0.01} value={layer.focusX ?? 0.5} onChange={(value) => onUpdate({ focusX: value })} />
              <Slider label="Position Y" min={0} max={1} step={0.01} value={layer.focusY ?? 0.5} onChange={(value) => onUpdate({ focusY: value })} />
              <Slider label="Opacity" min={0.1} max={1} step={0.02} value={layer.opacity ?? 1} onChange={(value) => onUpdate({ opacity: value })} />
              <button
                type="button"
                onClick={() => onUpdate({ scale: 1, focusX: 0.5, focusY: 0.5, darken: 0.38, opacity: 1 })}
                className="w-full rounded-md border border-[var(--border)] bg-white/5 px-2 py-1.5 text-[10px] text-[var(--muted-foreground)] transition hover:text-white"
              >
                Reset image framing
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                {(["contain", "cover"] as const).map((fit) => (
                  <button
                    key={fit}
                    type="button"
                    onClick={() => onUpdate({ fit })}
                    className={cn(
                      "flex-1 rounded-md px-1 py-1 text-[10px] capitalize transition",
                      (layer.fit ?? "contain") === fit ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-white/5 text-[var(--muted-foreground)] hover:text-white"
                    )}
                  >
                    {fit === "contain" ? "Fit (whole)" : "Fill (crop)"}
                  </button>
                ))}
              </div>
              <Slider label="Width" min={0.1} max={1} step={0.02} value={layer.width} onChange={(value) => onUpdate({ width: value })} />
              <Slider label="Height" min={0.1} max={1} step={0.02} value={layer.height} onChange={(value) => onUpdate({ height: value })} />
              <Slider label="Corner" min={0} max={0.5} step={0.02} value={layer.radius ?? 0} onChange={(value) => onUpdate({ radius: value })} />
              <Slider label="Opacity" min={0.1} max={1} step={0.02} value={layer.opacity ?? 1} onChange={(value) => onUpdate({ opacity: value })} />
              <p className="text-[10px] text-[var(--muted-foreground)]">Drag to move · drag the corner handles to scale.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-[11px] text-[var(--muted-foreground)]">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-[var(--accent)]"
      />
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  // Native color inputs need a #rrggbb value; fall back for gradients/rgba.
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : "#0b0b14";
  return (
    <input
      type="color"
      value={safe}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 w-9 cursor-pointer rounded border border-[var(--border)] bg-transparent"
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-[var(--muted-foreground)]">{children}</p>;
}
