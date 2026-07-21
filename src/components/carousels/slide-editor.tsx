"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Type,
  X
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aspectSpec, renderSlideCanvas } from "@/lib/carousels/render";
import { cn } from "@/lib/utils";
import type { CarouselAspectRatio, CarouselSlide, SlideLayer } from "@/types/domain";

type Mode = "preview" | "edit";

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
  onSave,
  onClose,
  saving
}: {
  slides: CarouselSlide[];
  ratio: CarouselAspectRatio;
  index: number;
  mode: Mode;
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
      color: "#ffffff",
      weight: 700,
      align: "left"
    };
    patchSlide((entry) => ({ ...entry, layers: [...(entry.layers ?? []), layer] }));
    setSelectedLayer(layer.id);
  };

  const addImageLayer = (src: string) => {
    const layer: SlideLayer = { id: uid(), type: "image", src, x: 0.25, y: 0.25, width: 0.5, height: 0.35, radius: 0.04 };
    patchSlide((entry) => ({ ...entry, layers: [...(entry.layers ?? []), layer] }));
    setSelectedLayer(layer.id);
  };

  const removeLayer = (layerId: string) => {
    patchSlide((entry) => ({ ...entry, layers: (entry.layers ?? []).filter((layer) => layer.id !== layerId) }));
    setSelectedLayer(null);
  };

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

/** Edit: canvas backdrop (bg + base chrome) with draggable DOM layers over it. */
function EditStage({
  slide,
  index,
  total,
  ratio,
  selectedLayer,
  onSelectLayer,
  onUpdateLayer
}: {
  slide: CarouselSlide;
  index: number;
  total: number;
  ratio: CarouselAspectRatio;
  selectedLayer: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, patch: Partial<SlideLayer>) => void;
}) {
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const spec = aspectSpec(ratio);

  // Repaint the backdrop (everything except text layers) when base copy,
  // background, or image layers change.
  const backdropDeps = JSON.stringify({
    bg: slide.background,
    hc: slide.headingColor,
    bc: slide.bodyColor,
    h: slide.heading,
    b: slide.body,
    hide: slide.hideBaseText,
    imgs: (slide.layers ?? []).filter((l) => l.type === "image")
  });
  useEffect(() => {
    let cancelled = false;
    const backdropSlide: CarouselSlide = { ...slide, layers: (slide.layers ?? []).filter((l) => l.type === "image") };
    void renderSlideCanvas(backdropSlide, index, total, ratio).then((canvas) => {
      if (cancelled) return;
      const target = backdropRef.current;
      if (!target) return;
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext("2d")?.drawImage(canvas, 0, 0);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backdropDeps, index, total, ratio]);

  const textLayers = (slide.layers ?? []).filter((l): l is Extract<SlideLayer, { type: "text" }> => l.type === "text");

  // Pointer drag: convert pixel deltas to slide fractions.
  const startDrag = (event: React.PointerEvent, layer: Extract<SlideLayer, { type: "text" }>) => {
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
      onUpdateLayer(layer.id, {
        x: Math.max(0, Math.min(0.98, originX + dx)),
        y: Math.max(0, Math.min(0.98, originY + dy))
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={stageRef}
      className="modal-panel-enter relative max-h-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
      style={{ aspectRatio: `${spec.width} / ${spec.height}`, height: "min(72vh, 100%)" }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget || event.target === backdropRef.current) onSelectLayer(null);
      }}
    >
      <canvas ref={backdropRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {textLayers.map((layer) => (
        <div
          key={layer.id}
          onPointerDown={(event) => startDrag(event, layer)}
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
        </div>
      ))}
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
  onAddImage
}: {
  slide: CarouselSlide;
  selectedLayer: string | null;
  onPatchSlide: (updater: (slide: CarouselSlide) => CarouselSlide) => void;
  onUpdateLayer: (id: string, patch: Partial<SlideLayer>) => void;
  onRemoveLayer: (id: string) => void;
  onAddText: () => void;
  onAddImage: (src: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const layer = (slide.layers ?? []).find((entry) => entry.id === selectedLayer) ?? null;

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Drop an image file (PNG, JPG…).");
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && onAddImage(reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="panel-enter flex w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:w-72">
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

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="gap-1.5 px-2 py-2 text-xs" onClick={onAddText}>
          <Type className="h-3.5 w-3.5" /> Add text
        </Button>
        <Button variant="secondary" className="gap-1.5 px-2 py-2 text-xs" onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" /> Add image
        </Button>
      </div>

      {layer ? (
        <LayerControls layer={layer} onUpdate={(patch) => onUpdateLayer(layer.id, patch)} onRemove={() => onRemoveLayer(layer.id)} />
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-center text-[11px] text-[var(--muted-foreground)]">
          Select a layer to edit it, or drag one on the stage.
        </p>
      )}

      <div className="space-y-2 border-t border-[var(--border)] pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Slide</p>

        <label className="flex items-center justify-between text-xs text-white">
          Background
          <span className="flex items-center gap-1.5">
            <ColorInput
              value={slide.background ?? "#0b0b14"}
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
              <ColorInput value={slide.headingColor ?? "#ffffff"} onChange={(value) => onPatchSlide((entry) => ({ ...entry, headingColor: value }))} />
            </div>
            <div className="flex items-center justify-between text-xs text-white">
              Body color
              <ColorInput value={slide.bodyColor ?? "#d7d5e6"} onChange={(value) => onPatchSlide((entry) => ({ ...entry, bodyColor: value }))} />
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
          <Slider label="Width" min={0.1} max={1} step={0.02} value={layer.width} onChange={(value) => onUpdate({ width: value })} />
          <Slider label="Height" min={0.1} max={1} step={0.02} value={layer.height} onChange={(value) => onUpdate({ height: value })} />
          <Slider label="Corner" min={0} max={0.5} step={0.02} value={layer.radius ?? 0} onChange={(value) => onUpdate({ radius: value })} />
          <p className="text-[10px] text-[var(--muted-foreground)]">Drag on the stage to reposition.</p>
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
