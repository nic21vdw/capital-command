"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Eraser, ImagePlus, Layers, MousePointer2, Plus, RotateCw, Sparkles, Trash2, X, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { BACKGROUND_STYLES, getStyle } from "@/lib/thumbnails/backgrounds";
import { removeImageBackground } from "@/lib/thumbnails/bg-removal";
import { DEFAULT_FONT_ID, ensureFontLoaded, FONT_OPTIONS, getFont, GOOGLE_FONTS_HREF } from "@/lib/thumbnails/fonts";
import { buildVariants, computeLayout, hitTest, renderEditor, renderThumbnail, renderToDataUrl } from "@/lib/thumbnails/render";
import { overlayIdeas, titleTreatments } from "@/lib/thumbnails/suggestions";
import {
  DEFAULT_TEXT_TRANSFORM,
  DEFAULT_TREATMENT,
  defaultImageTransform,
  MAX_IMAGES,
  type BackgroundStyleId,
  type ImageLayer,
  type ImageTreatment,
  type Intensity,
  type Sticker,
  type StickerType,
  type TextEmphasis,
  type TextPosition,
  type TextSize,
  type ThumbnailOptions,
  type Transform
} from "@/lib/thumbnails/types";
import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type Variant = { label: string; png: string; jpeg: string };

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Clipboard access was blocked by the browser.");
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

let layerCounter = 0;
function nextLayerId() {
  layerCounter += 1;
  return `img-${layerCounter}`;
}

function makeLayer(name: string, image: HTMLImageElement, index: number): ImageLayer {
  return { id: nextLayerId(), name, image, transform: defaultImageTransform(index), treatment: { ...DEFAULT_TREATMENT } };
}

const STICKER_PRESETS: { type: StickerType; label: string; defaults: Partial<Sticker> }[] = [
  { type: "circle", label: "Circle", defaults: { color: "#ff2d2d" } },
  { type: "arrow", label: "Arrow", defaults: { color: "#ff2d2d" } },
  { type: "emoji", label: "Emoji", defaults: { text: "🔥" } },
  { type: "badge", label: "Badge", defaults: { color: "#ffd34d", text: "$10K" } }
];

const EMOJI_CHOICES = ["🔥", "😱", "💰", "✅", "❌", "🤯", "👀", "💀", "⚡", "🚀"];

/** A compact labelled range slider matching the app's dark styling. */
function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span className="uppercase tracking-wide">{label}</span>
        <span className="text-white">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
      />
    </label>
  );
}

export function ThumbnailGeneratorPage() {
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickerSeq = useRef(0);

  const [images, setImages] = useState<ImageLayer[]>([]);
  const [title, setTitle] = useState("");
  const [overlayText, setOverlayText] = useState("");
  const [styleId, setStyleId] = useState<BackgroundStyleId>("gradient");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [intensity, setIntensity] = useState<Intensity>("balanced");
  const [emphasis, setEmphasis] = useState<TextEmphasis>("outline");
  const [position, setPosition] = useState<TextPosition>("left");
  const [size, setSize] = useState<TextSize>("medium");
  const [uppercase, setUppercase] = useState(true);

  // Text styling
  const [fontId, setFontId] = useState(DEFAULT_FONT_ID);
  const [textColor, setTextColor] = useState("auto");
  const [highlightColor, setHighlightColor] = useState("#ffd34d");

  // Layout / placement
  const [textTransform, setTextTransform] = useState<Transform>(DEFAULT_TEXT_TRANSFORM);
  const [manualLayout, setManualLayout] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Subject background removal
  const [removingBg, setRemovingBg] = useState(false);
  const [bgTolerance, setBgTolerance] = useState(32);

  // Call-outs + export
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [exportScale, setExportScale] = useState(1);
  const [smallPreview, setSmallPreview] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);

  // Bumped once a networked font has finished loading, to force a re-render.
  const [fontTick, setFontTick] = useState(0);

  const style = getStyle(styleId);
  const options: ThumbnailOptions = useMemo(
    () => ({
      images,
      text: overlayText,
      textTransform,
      manualLayout,
      style: styleId,
      paletteIndex,
      intensity,
      emphasis,
      position,
      size,
      uppercase,
      fontId,
      textColor,
      highlightColor,
      stickers
    }),
    [images, overlayText, textTransform, manualLayout, styleId, paletteIndex, intensity, emphasis, position, size, uppercase, fontId, textColor, highlightColor, stickers]
  );

  // Keep the latest options/images available to handlers without re-binding.
  const optionsRef = useRef(options);
  const imagesRef = useRef(images);
  useEffect(() => {
    optionsRef.current = options;
    imagesRef.current = images;
  }, [options, images]);

  // Load the Google Fonts stylesheet once so display faces are available.
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById("thumb-google-fonts")) return;
    const link = document.createElement("link");
    link.id = "thumb-google-fonts";
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_HREF;
    document.head.appendChild(link);
  }, []);

  // Warm up the selected font, then re-render once it's ready (canvas silently
  // falls back to a system face if the font hasn't loaded yet).
  useEffect(() => {
    let cancelled = false;
    void ensureFontLoaded(getFont(fontId)).then(() => {
      if (!cancelled) setFontTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [fontId]);

  // Live preview re-renders on every settings change (with edit chrome when editing).
  useEffect(() => {
    if (!previewRef.current) return;
    if (editing) {
      renderEditor(previewRef.current, options, selectedId);
    } else {
      renderThumbnail(previewRef.current, options);
    }
    setSmallPreview(previewRef.current.toDataURL("image/jpeg", 0.9));
  }, [options, editing, selectedId, fontTick]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    const room = MAX_IMAGES - imagesRef.current.length;
    if (room <= 0) {
      toast.error(`You can place up to ${MAX_IMAGES} images.`);
      return;
    }
    if (list.length > room) toast.error(`Only ${room} more image(s) could be added (max ${MAX_IMAGES}).`);
    list.slice(0, room).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`"${file.name}" is not an image. Upload a PNG, JPEG, or WebP.`);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`"${file.name}" is over 15MB. Export a smaller version and try again.`);
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setImages((existing) => (existing.length >= MAX_IMAGES ? existing : [...existing, makeLayer(file.name, img, existing.length)]));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        toast.error(`The browser could not decode "${file.name}".`);
      };
      img.src = url;
    });
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((current) => current.filter((layer) => layer.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const moveLayer = useCallback((id: string, direction: -1 | 1) => {
    setImages((current) => {
      const index = current.findIndex((layer) => layer.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const updateSelectedTransform = useCallback(
    (partial: Partial<Transform>) => {
      if (selectedId === "text") {
        setTextTransform((current) => ({ ...current, ...partial }));
      } else if (selectedId) {
        setImages((current) =>
          current.map((layer) => (layer.id === selectedId ? { ...layer, transform: { ...layer.transform, ...partial } } : layer))
        );
      }
    },
    [selectedId]
  );

  const selectedTransform: Transform | null = useMemo(() => {
    if (selectedId === "text") return textTransform;
    return images.find((layer) => layer.id === selectedId)?.transform ?? null;
  }, [selectedId, textTransform, images]);

  const enterEditMode = useCallback(() => {
    setManualLayout(true);
    setEditing(true);
  }, []);

  // The image whose cut-out treatment the Subject panel edits: the selected
  // image layer, or the first image when text/nothing is selected.
  const activeImage = useMemo(() => {
    const selected = images.find((layer) => layer.id === selectedId);
    return selected ?? images[0] ?? null;
  }, [images, selectedId]);

  const updateTreatment = useCallback((id: string, patch: Partial<ImageTreatment>) => {
    setImages((current) => current.map((layer) => (layer.id === id ? { ...layer, treatment: { ...layer.treatment, ...patch } } : layer)));
  }, []);

  const handleRemoveBackground = async () => {
    if (!activeImage) return;
    const targetId = activeImage.id;
    setRemovingBg(true);
    try {
      const cut = await removeImageBackground(activeImage.image, bgTolerance);
      setImages((current) =>
        current.map((layer) =>
          layer.id === targetId
            ? { ...layer, image: cut, treatment: { ...layer.treatment, cutout: true, stroke: layer.treatment.stroke === 0 ? 10 : layer.treatment.stroke } }
            : layer
        )
      );
      toast.success("Background removed — switched to cut-out mode.");
    } catch {
      toast.error("Could not process that image. Try a higher tolerance.");
    } finally {
      setRemovingBg(false);
    }
  };

  // ----- Interactive dragging on the canvas -----
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const pointerToCanvas = (clientX: number, clientY: number) => {
    const canvas = previewRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * canvas.width, y: ((clientY - rect.top) / rect.height) * canvas.height };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editing) return;
    const point = pointerToCanvas(event.clientX, event.clientY);
    if (!point) return;
    const layout = computeLayout(optionsRef.current);
    // Topmost layer first (text is last in the layout array).
    const hit = [...layout].reverse().find((box) => hitTest(box, point.x, point.y));
    if (!hit) {
      setSelectedId(null);
      return;
    }
    setSelectedId(hit.id);
    const canvas = previewRef.current!;
    dragRef.current = { id: hit.id, offsetX: point.x / canvas.width - hit.cx / canvas.width, offsetY: point.y / canvas.height - hit.cy / canvas.height };
    canvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!editing || !drag) return;
    const point = pointerToCanvas(event.clientX, event.clientY);
    const canvas = previewRef.current;
    if (!point || !canvas) return;
    const x = clamp(point.x / canvas.width - drag.offsetX, 0, 1);
    const y = clamp(point.y / canvas.height - drag.offsetY, 0, 1);
    if (drag.id === "text") {
      setTextTransform((current) => ({ ...current, x, y }));
    } else {
      setImages((current) => current.map((layer) => (layer.id === drag.id ? { ...layer, transform: { ...layer.transform, x, y } } : layer)));
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current && previewRef.current?.hasPointerCapture(event.pointerId)) {
      previewRef.current.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  // ----- Call-outs -----
  const addSticker = (type: StickerType, defaults: Partial<Sticker>) => {
    stickerSeq.current += 1;
    setStickers((prev) => [
      ...prev,
      { id: `sticker-${stickerSeq.current}`, type, x: 0.5, y: 0.45, scale: 1, rotation: 0, color: defaults.color ?? "#ff2d2d", text: defaults.text ?? "" }
    ]);
  };
  const updateSticker = (id: string, patch: Partial<Sticker>) => setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSticker = (id: string) => setStickers((prev) => prev.filter((s) => s.id !== id));

  const generateVariants = () => {
    if (!overlayText.trim() && images.length === 0) {
      toast.error("Add thumbnail text or upload an image first.");
      return;
    }
    const specs = buildVariants(options);
    setVariants(specs.map((spec) => ({ label: spec.label, png: renderToDataUrl(spec.options, "png"), jpeg: renderToDataUrl(spec.options, "jpeg") })));
    toast.success(`Generated ${specs.length} variants.`);
  };

  const ideas = useMemo(() => overlayIdeas(title), [title]);
  const treatments = useMemo(() => titleTreatments(title), [title]);
  const exportName = (suffix: string) =>
    `thumbnail-${(title || overlayText || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}${suffix}`;

  const selectedLabel = selectedId === "text" ? "Text" : images.find((l) => l.id === selectedId)?.name ?? null;
  const customColor = textColor !== "auto";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Tools"
        title="Thumbnail Generator"
        description="Create 1280×720 YouTube thumbnails: stack up to 5 images, cut out your subject, add bold call-outs, pick a font, and color your keywords. Double-click the preview to move, scale, and rotate. Everything renders in your browser."
      />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        {/* Left: controls */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Images</h2>
              <Badge>
                {images.length}/{MAX_IMAGES}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Add up to {MAX_IMAGES} images. In free-placement mode each one can be dragged, rotated, and scaled on the canvas.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) handleFiles(event.target.files);
                event.target.value = "";
              }}
            />

            {images.length > 0 && (
              <div className="mt-4 space-y-2">
                {images.map((layer, index) => (
                  <div
                    key={layer.id}
                    onClick={() => setSelectedId(layer.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 transition",
                      selectedId === layer.id ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-white/10 bg-black/20 hover:border-white/30"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={layer.image.src} alt={layer.name} className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover" />
                    <p className="min-w-0 flex-1 truncate text-sm text-white">{layer.name}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        title="Send backward"
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveLayer(layer.id, -1);
                        }}
                        className="rounded-lg bg-white/8 px-2 py-1 text-xs text-white transition hover:bg-white/15 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title="Bring forward"
                        disabled={index === images.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveLayer(layer.id, 1);
                        }}
                        className="rounded-lg bg-white/8 px-2 py-1 text-xs text-white transition hover:bg-white/15 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Remove image"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeImage(layer.id);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {images.length < MAX_IMAGES && (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
                }}
                onDragOver={(event) => event.preventDefault()}
                className="mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/12 bg-white/3 py-6 transition hover:border-[var(--accent)]/50"
              >
                <ImagePlus className="h-6 w-6 text-[var(--accent)]" />
                <p className="text-sm font-medium text-white">Drop images or click to browse</p>
                <p className="text-xs text-[var(--muted-foreground)]">PNG, JPEG, or WebP · up to 15MB each</p>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <Input placeholder="Video title or topic (drives copy suggestions)" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input
                placeholder="Thumbnail text — wrap a word in *asterisks* to color it"
                value={overlayText}
                onChange={(event) => setOverlayText(event.target.value)}
              />
            </div>
          </Card>

          {activeImage && (
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Subject</h2>
                <span className="max-w-[55%] truncate text-xs text-[var(--muted-foreground)]">{activeImage.name}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Cut-out treatment for the selected image. Remove its background for the floating-subject look.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Placement</span>
                  <Select
                    value={activeImage.treatment.cutout ? "cutout" : "panel"}
                    onChange={(event) => updateTreatment(activeImage.id, { cutout: event.target.value === "cutout" })}
                  >
                    <option value="panel">Right panel (auto)</option>
                    <option value="cutout">Free cut-out</option>
                  </Select>
                </label>
                <label className="flex items-end gap-2 pb-3 text-sm text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={activeImage.treatment.flip}
                    onChange={(event) => updateTreatment(activeImage.id, { flip: event.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Flip horizontally
                </label>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Range label="Stroke" value={activeImage.treatment.stroke} min={0} max={28} step={1} onChange={(v) => updateTreatment(activeImage.id, { stroke: v })} format={(v) => `${v}px`} />
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Stroke color</span>
                  <input
                    type="color"
                    value={activeImage.treatment.strokeColor}
                    onChange={(event) => updateTreatment(activeImage.id, { strokeColor: event.target.value })}
                    className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                  />
                </label>
                <Range label="Glow" value={activeImage.treatment.glow} min={0} max={1} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { glow: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Saturation" value={activeImage.treatment.saturate} min={0} max={2} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { saturate: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Contrast" value={activeImage.treatment.contrast} min={0.5} max={1.8} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { contrast: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Brightness" value={activeImage.treatment.brightness} min={0.5} max={1.6} step={0.05} onChange={(v) => updateTreatment(activeImage.id, { brightness: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeImage.treatment.shadow}
                    onChange={(event) => updateTreatment(activeImage.id, { shadow: event.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Drop shadow
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeImage.treatment.backlight}
                    onChange={(event) => updateTreatment(activeImage.id, { backlight: event.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Accent backlight
                </label>
              </div>

              <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                <Range label="BG removal tolerance" value={bgTolerance} min={8} max={120} step={2} onChange={setBgTolerance} />
                <Button variant="secondary" className="w-full" onClick={handleRemoveBackground} disabled={removingBg}>
                  <Eraser className="mr-2 h-4 w-4" />
                  {removingBg ? "Removing…" : "Remove background"}
                </Button>
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Layout</h2>
              <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={manualLayout}
                  onChange={(event) => {
                    setManualLayout(event.target.checked);
                    if (!event.target.checked) setEditing(false);
                  }}
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                Free placement
              </label>
            </div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {manualLayout
                ? "Drag text and images anywhere. Use the controls below or the canvas to position them."
                : "Automatic, background-aware layout. Turn on free placement (or double-click the preview) to move things yourself."}
            </p>

            {manualLayout && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant={editing ? "primary" : "secondary"} className="flex-1" onClick={() => setEditing((value) => !value)}>
                    <MousePointer2 className="mr-2 h-4 w-4" />
                    {editing ? "Editing on" : "Edit on canvas"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setTextTransform(DEFAULT_TEXT_TRANSFORM);
                      setImages((current) => current.map((layer, index) => ({ ...layer, transform: defaultImageTransform(index) })));
                      toast.success("Layout reset.");
                    }}
                  >
                    Reset
                  </Button>
                </div>

                {/* Layer selector */}
                <div className="flex flex-wrap gap-2">
                  {overlayText.trim() && (
                    <button
                      type="button"
                      onClick={() => setSelectedId("text")}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                        selectedId === "text" ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white" : "border-white/10 bg-black/20 text-[var(--muted-foreground)] hover:border-white/30"
                      )}
                    >
                      Text
                    </button>
                  )}
                  {images.map((layer, index) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setSelectedId(layer.id)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                        selectedId === layer.id ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white" : "border-white/10 bg-black/20 text-[var(--muted-foreground)] hover:border-white/30"
                      )}
                    >
                      Image {index + 1}
                    </button>
                  ))}
                </div>

                {selectedTransform && selectedLabel ? (
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium text-white">
                        <Layers className="h-4 w-4 text-[var(--accent)]" />
                        {selectedLabel}
                      </span>
                      {selectedId !== "text" && (
                        <button
                          type="button"
                          onClick={() => selectedId && removeImage(selectedId)}
                          className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      )}
                    </div>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1">
                          <ZoomIn className="h-3.5 w-3.5" /> Scale
                        </span>
                        <span>{selectedTransform.scale.toFixed(2)}×</span>
                      </span>
                      <input
                        type="range"
                        min={0.2}
                        max={3}
                        step={0.01}
                        value={selectedTransform.scale}
                        onChange={(event) => updateSelectedTransform({ scale: Number(event.target.value) })}
                        className="w-full accent-[var(--accent)]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1">
                          <RotateCw className="h-3.5 w-3.5" /> Rotation
                        </span>
                        <span>{Math.round(selectedTransform.rotation)}°</span>
                      </span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={selectedTransform.rotation}
                        onChange={(event) => updateSelectedTransform({ rotation: Number(event.target.value) })}
                        className="w-full accent-[var(--accent)]"
                      />
                    </label>
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-3 text-xs text-[var(--muted-foreground)]">
                    Select a layer above (or click it on the canvas) to scale and rotate it.
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Style</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Background</span>
                <Select
                  value={styleId}
                  onChange={(event) => {
                    setStyleId(event.target.value as BackgroundStyleId);
                    setPaletteIndex(0);
                  }}
                >
                  {BACKGROUND_STYLES.map((bg) => (
                    <option key={bg.id} value={bg.id}>
                      {bg.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Font</span>
                <Select value={fontId} onChange={(event) => setFontId(event.target.value)}>
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Intensity</span>
                <Select value={intensity} onChange={(event) => setIntensity(event.target.value as Intensity)}>
                  <option value="subtle">Subtle</option>
                  <option value="balanced">Balanced</option>
                  <option value="bold">Bold</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Text emphasis</span>
                <Select value={emphasis} onChange={(event) => setEmphasis(event.target.value as TextEmphasis)}>
                  <option value="outline">Outline</option>
                  <option value="highlight-bar">Highlight bar</option>
                  <option value="boxed">Boxed panel</option>
                  <option value="clean">Clean shadow</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Text position</span>
                <Select value={position} onChange={(event) => setPosition(event.target.value as TextPosition)} disabled={manualLayout}>
                  <option value="left">Left</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="center">Center</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Text size</span>
                <Select value={size} onChange={(event) => setSize(event.target.value as TextSize)}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </Select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Highlight color (*word*)</span>
                <input
                  type="color"
                  value={highlightColor}
                  onChange={(event) => setHighlightColor(event.target.value)}
                  className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                />
              </label>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={customColor}
                    onChange={(event) => setTextColor(event.target.checked ? "#ffffff" : "auto")}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Custom text color
                </label>
                {customColor && (
                  <input
                    type="color"
                    value={textColor}
                    onChange={(event) => setTextColor(event.target.value)}
                    className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                  />
                )}
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(event) => setUppercase(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-black/20"
              />
              Uppercase text
            </label>

            <div className="mt-4">
              <span className="mb-2 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Palette: {style.palettes[paletteIndex % style.palettes.length].name}
              </span>
              <div className="flex flex-wrap gap-2">
                {style.palettes.map((palette, index) => (
                  <button
                    key={palette.name}
                    type="button"
                    title={palette.name}
                    onClick={() => setPaletteIndex(index)}
                    className={cn(
                      "flex h-9 items-center gap-0 overflow-hidden rounded-xl border transition",
                      index === paletteIndex % style.palettes.length ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/40" : "border-white/10 hover:border-white/30"
                    )}
                  >
                    {[palette.bg1, palette.bg2, palette.accent].map((color, swatch) => (
                      <span key={swatch} className="h-full w-7" style={{ backgroundColor: color }} />
                    ))}
                  </button>
                ))}
              </div>
            </div>

            <Button className="mt-5 w-full" onClick={generateVariants}>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate 10 variants
            </Button>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Call-outs</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Add circles, arrows, emoji, and number badges. Position them with the sliders.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STICKER_PRESETS.map((preset) => (
                <button
                  key={preset.type}
                  type="button"
                  onClick={() => addSticker(preset.type, preset.defaults)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-white transition hover:border-[var(--accent)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {preset.label}
                </button>
              ))}
            </div>

            {stickers.length > 0 && (
              <div className="mt-4 space-y-3">
                {stickers.map((sticker) => (
                  <div key={sticker.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-white">{sticker.type}</span>
                      <button
                        type="button"
                        title="Remove call-out"
                        onClick={() => removeSticker(sticker.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {sticker.type === "emoji" && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {EMOJI_CHOICES.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => updateSticker(sticker.id, { text: emoji })}
                            className={cn(
                              "rounded-lg px-2 py-1 text-base transition",
                              sticker.text === emoji ? "bg-[var(--accent)]/25 ring-1 ring-[var(--accent)]" : "bg-white/5 hover:bg-white/10"
                            )}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    {sticker.type === "badge" && (
                      <Input
                        className="mt-2"
                        placeholder="Badge text (e.g. $10K)"
                        value={sticker.text}
                        onChange={(event) => updateSticker(sticker.id, { text: event.target.value })}
                      />
                    )}

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Range label="X" value={sticker.x} min={0} max={1} step={0.01} onChange={(v) => updateSticker(sticker.id, { x: v })} format={(v) => v.toFixed(2)} />
                      <Range label="Y" value={sticker.y} min={0} max={1} step={0.01} onChange={(v) => updateSticker(sticker.id, { y: v })} format={(v) => v.toFixed(2)} />
                      <Range label="Scale" value={sticker.scale} min={0.3} max={3} step={0.05} onChange={(v) => updateSticker(sticker.id, { scale: v })} format={(v) => `${Math.round(v * 100)}%`} />
                      <Range label="Rotation" value={sticker.rotation} min={-180} max={180} step={5} onChange={(v) => updateSticker(sticker.id, { rotation: v })} format={(v) => `${v}°`} />
                    </div>

                    {sticker.type !== "emoji" && (
                      <label className="mt-2 block">
                        <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Color</span>
                        <input
                          type="color"
                          value={sticker.color}
                          onChange={(event) => updateSticker(sticker.id, { color: event.target.value })}
                          className="h-9 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {(ideas.length > 0 || treatments.length > 0) && (
            <Card>
              <h2 className="text-lg font-semibold text-white">Copy ideas</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Derived from your title. Click to use as thumbnail text.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ideas.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setOverlayText(idea)}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-white transition hover:border-[var(--accent)]"
                  >
                    {idea}
                  </button>
                ))}
              </div>
              {treatments.length > 0 && (
                <div className="mt-4 space-y-2">
                  <span className="block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Video title treatments</span>
                  {treatments.map((treatment) => (
                    <div key={treatment} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2">
                      <p className="text-sm text-white">{treatment}</p>
                      <button
                        type="button"
                        title="Copy title"
                        onClick={() => void copyText(treatment, "Title")}
                        className="shrink-0 text-[var(--muted-foreground)] transition hover:text-white"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Right: preview + variants */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Preview</h2>
              <div className="flex items-center gap-2">
                {editing && <Badge>Editing</Badge>}
                <Badge>1280 × 720</Badge>
              </div>
            </div>
            <canvas
              ref={previewRef}
              onDoubleClick={enterEditMode}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                "mt-4 aspect-video w-full touch-none rounded-2xl border bg-black/40",
                editing ? "cursor-move border-[var(--accent)]/60" : "cursor-pointer border-white/10"
              )}
            />
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              {editing
                ? "Drag any layer to reposition it. Click empty space to deselect. Use the Layout panel to scale and rotate."
                : "Double-click to edit the layout directly on the canvas."}
            </p>

            <div className="mt-4 flex items-start gap-4">
              <div className="shrink-0">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Mobile feed size</span>
                {smallPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={smallPreview} alt="Small preview" className="w-40 rounded-md border border-white/10" style={{ aspectRatio: "16 / 9" }} />
                ) : (
                  <div className="w-40 rounded-md border border-white/10 bg-black/40" style={{ aspectRatio: "16 / 9" }} />
                )}
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Check the small render — thumbnails are mostly seen at this size. Keep text to 1–4 words and faces large.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => downloadDataUrl(renderToDataUrl(options, "png", exportScale), exportName(".png"))}>
                <Download className="mr-2 h-4 w-4" />
                Download PNG
              </Button>
              <Button variant="secondary" onClick={() => downloadDataUrl(renderToDataUrl(options, "jpeg", exportScale), exportName(".jpg"))}>
                <Download className="mr-2 h-4 w-4" />
                Download JPEG
              </Button>
              <label className="ml-auto flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                Export
                <Select value={String(exportScale)} onChange={(event) => setExportScale(Number(event.target.value))} className="h-9 w-auto px-2">
                  <option value="1">1× (1280)</option>
                  <option value="2">2× (2560)</option>
                </Select>
              </label>
            </div>
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">{style.description}</p>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Variants</h2>
            {variants.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Set up your thumbnail on the left, then hit <span className="text-white">Generate 10 variants</span> for options with rotated palettes,
                emphasis, and varied text/image positions and rotations.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {variants.map((variant, index) => (
                  <div key={variant.label} className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={variant.png} alt={variant.label} className="aspect-video w-full rounded-xl border border-white/10" />
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{variant.label}</p>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          title="Download PNG"
                          onClick={() => downloadDataUrl(variant.png, exportName(`-${index + 1}.png`))}
                          className="rounded-lg bg-white/8 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/15"
                        >
                          PNG
                        </button>
                        <button
                          type="button"
                          title="Download JPEG"
                          onClick={() => downloadDataUrl(variant.jpeg, exportName(`-${index + 1}.jpg`))}
                          className="rounded-lg bg-white/8 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/15"
                        >
                          JPG
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
