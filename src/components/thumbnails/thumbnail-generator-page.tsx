"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Eraser, ImagePlus, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { BACKGROUND_STYLES, getStyle } from "@/lib/thumbnails/backgrounds";
import { removeImageBackground } from "@/lib/thumbnails/bg-removal";
import { buildVariants, renderThumbnail, renderToDataUrl } from "@/lib/thumbnails/render";
import { overlayIdeas, titleTreatments } from "@/lib/thumbnails/suggestions";
import {
  DEFAULT_THUMBNAIL_OPTIONS,
  FONT_LABELS,
  type BackgroundStyleId,
  type FontFamilyId,
  type Intensity,
  type Sticker,
  type StickerType,
  type SubjectMode,
  type TextEmphasis,
  type TextPosition,
  type TextSize,
  type ThumbnailOptions
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

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [removingBg, setRemovingBg] = useState(false);
  const [bgTolerance, setBgTolerance] = useState(32);
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
  const [fontFamily, setFontFamily] = useState<FontFamilyId>("impact");
  const [highlightColor, setHighlightColor] = useState(DEFAULT_THUMBNAIL_OPTIONS.highlightColor);
  const [textColor, setTextColor] = useState("");
  const [textRotation, setTextRotation] = useState(0);

  // Subject treatment
  const [subjectMode, setSubjectMode] = useState<SubjectMode>("panel");
  const [subjectScale, setSubjectScale] = useState(1);
  const [subjectX, setSubjectX] = useState(0);
  const [subjectY, setSubjectY] = useState(0);
  const [subjectFlip, setSubjectFlip] = useState(false);
  const [subjectStroke, setSubjectStroke] = useState(0);
  const [subjectStrokeColor, setSubjectStrokeColor] = useState("#ffffff");
  const [subjectGlow, setSubjectGlow] = useState(0);
  const [subjectShadow, setSubjectShadow] = useState(true);
  const [subjectBacklight, setSubjectBacklight] = useState(false);
  const [saturate, setSaturate] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [brightness, setBrightness] = useState(1);

  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [exportScale, setExportScale] = useState(1);
  const [smallPreview, setSmallPreview] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);

  const style = getStyle(styleId);
  const options: ThumbnailOptions = useMemo(
    () => ({
      image,
      text: overlayText,
      style: styleId,
      paletteIndex,
      intensity,
      emphasis,
      position,
      size,
      uppercase,
      fontFamily,
      highlightColor,
      textColor,
      textRotation,
      subjectMode,
      subjectScale,
      subjectX,
      subjectY,
      subjectFlip,
      subjectStroke,
      subjectStrokeColor,
      subjectGlow,
      subjectShadow,
      subjectBacklight,
      saturate,
      contrast,
      brightness,
      stickers
    }),
    [
      image,
      overlayText,
      styleId,
      paletteIndex,
      intensity,
      emphasis,
      position,
      size,
      uppercase,
      fontFamily,
      highlightColor,
      textColor,
      textRotation,
      subjectMode,
      subjectScale,
      subjectX,
      subjectY,
      subjectFlip,
      subjectStroke,
      subjectStrokeColor,
      subjectGlow,
      subjectShadow,
      subjectBacklight,
      saturate,
      contrast,
      brightness,
      stickers
    ]
  );

  // Live preview re-renders on every settings change. Runs only on the client,
  // so the small preview is derived from the same canvas (no SSR canvas use).
  useEffect(() => {
    if (previewRef.current) {
      renderThumbnail(previewRef.current, options);
      setSmallPreview(previewRef.current.toDataURL("image/jpeg", 0.9));
    }
  }, [options]);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(`"${file.name}" is not an image. Upload a PNG, JPEG, or WebP.`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("That image is over 15MB. Export a smaller version and try again.");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setImageName(file.name);
      toast.success("Image loaded.");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("The browser could not decode that image file.");
    };
    img.src = url;
  }, []);

  const handleRemoveBackground = async () => {
    if (!image) return;
    setRemovingBg(true);
    try {
      const cut = await removeImageBackground(image, bgTolerance);
      setImage(cut);
      setSubjectMode("cutout");
      if (subjectStroke === 0) setSubjectStroke(10);
      toast.success("Background removed — switched to cut-out mode.");
    } catch {
      toast.error("Could not process that image. Try a higher tolerance.");
    } finally {
      setRemovingBg(false);
    }
  };

  const addSticker = (type: StickerType, defaults: Partial<Sticker>) => {
    stickerSeq.current += 1;
    const id = `sticker-${stickerSeq.current}`;
    setStickers((prev) => [
      ...prev,
      {
        id,
        type,
        x: 0.5,
        y: 0.45,
        scale: 1,
        rotation: 0,
        color: defaults.color ?? "#ff2d2d",
        text: defaults.text ?? ""
      }
    ]);
  };

  const updateSticker = (id: string, patch: Partial<Sticker>) => {
    setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSticker = (id: string) => {
    setStickers((prev) => prev.filter((s) => s.id !== id));
  };

  const generateVariants = () => {
    if (!overlayText.trim() && !image) {
      toast.error("Add thumbnail text or upload an image first.");
      return;
    }
    const specs = buildVariants(options);
    setVariants(
      specs.map((spec) => ({
        label: spec.label,
        png: renderToDataUrl(spec.options, "png"),
        jpeg: renderToDataUrl(spec.options, "jpeg")
      }))
    );
    toast.success("Generated 4 variants.");
  };

  const ideas = useMemo(() => overlayIdeas(title), [title]);
  const treatments = useMemo(() => titleTreatments(title), [title]);
  const exportName = (suffix: string) =>
    `thumbnail-${(title || overlayText || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}${suffix}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Tools"
        title="Thumbnail Generator"
        description="Create 1280×720 YouTube thumbnails: cut out your subject, stack bold call-outs, and color your keywords. Everything renders in your browser."
      />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        {/* Left: controls */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold text-white">Source</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Optional. Upload a face or product shot, then remove its background for a cut-out look.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
                event.target.value = "";
              }}
            />
            {image ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <p className="truncate text-sm text-white">{imageName}</p>
                  <button
                    type="button"
                    title="Remove image"
                    onClick={() => {
                      setImage(null);
                      setImageName(null);
                    }}
                    className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/8 text-[var(--muted-foreground)] transition hover:bg-red-500/20 hover:text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Range
                  label="BG removal tolerance"
                  value={bgTolerance}
                  min={8}
                  max={120}
                  step={2}
                  onChange={setBgTolerance}
                />
                <Button variant="secondary" className="w-full" onClick={handleRemoveBackground} disabled={removingBg}>
                  <Eraser className="mr-2 h-4 w-4" />
                  {removingBg ? "Removing…" : "Remove background"}
                </Button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                onDragOver={(event) => event.preventDefault()}
                className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/12 bg-white/3 py-8 transition hover:border-[var(--accent)]/50"
              >
                <ImagePlus className="h-6 w-6 text-[var(--accent)]" />
                <p className="text-sm font-medium text-white">Drop an image or click to browse</p>
                <p className="text-xs text-[var(--muted-foreground)]">PNG, JPEG, or WebP · up to 15MB</p>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <Input
                placeholder="Video title or topic (drives copy suggestions)"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Input
                placeholder="Thumbnail text — wrap a word in *asterisks* to color it"
                value={overlayText}
                onChange={(event) => setOverlayText(event.target.value)}
              />
            </div>
          </Card>

          {image && (
            <Card>
              <h2 className="text-lg font-semibold text-white">Subject</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Placement</span>
                  <Select value={subjectMode} onChange={(event) => setSubjectMode(event.target.value as SubjectMode)}>
                    <option value="panel">Right panel</option>
                    <option value="cutout">Free cut-out</option>
                  </Select>
                </label>
                <label className="flex items-end gap-2 pb-3 text-sm text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={subjectFlip}
                    onChange={(event) => setSubjectFlip(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Flip horizontally
                </label>
              </div>

              {subjectMode === "cutout" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Range label="Size" value={subjectScale} min={0.4} max={1.8} step={0.05} onChange={setSubjectScale} format={(v) => `${Math.round(v * 100)}%`} />
                  <Range label="Stroke" value={subjectStroke} min={0} max={28} step={1} onChange={setSubjectStroke} format={(v) => `${v}px`} />
                  <Range label="Horizontal" value={subjectX} min={-1} max={1} step={0.02} onChange={setSubjectX} format={(v) => v.toFixed(2)} />
                  <Range label="Vertical" value={subjectY} min={-1} max={1} step={0.02} onChange={setSubjectY} format={(v) => v.toFixed(2)} />
                  <Range label="Glow" value={subjectGlow} min={0} max={1} step={0.05} onChange={setSubjectGlow} format={(v) => `${Math.round(v * 100)}%`} />
                  <label className="block">
                    <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Stroke color</span>
                    <input
                      type="color"
                      value={subjectStrokeColor}
                      onChange={(event) => setSubjectStrokeColor(event.target.value)}
                      className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                    />
                  </label>
                </div>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Range label="Saturation" value={saturate} min={0} max={2} step={0.05} onChange={setSaturate} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Contrast" value={contrast} min={0.5} max={1.8} step={0.05} onChange={setContrast} format={(v) => `${Math.round(v * 100)}%`} />
                <Range label="Brightness" value={brightness} min={0.5} max={1.6} step={0.05} onChange={setBrightness} format={(v) => `${Math.round(v * 100)}%`} />
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={subjectShadow}
                    onChange={(event) => setSubjectShadow(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Drop shadow
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={subjectBacklight}
                    onChange={(event) => setSubjectBacklight(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-black/20"
                  />
                  Accent backlight
                </label>
              </div>
            </Card>
          )}

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
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Intensity</span>
                <Select value={intensity} onChange={(event) => setIntensity(event.target.value as Intensity)}>
                  <option value="subtle">Subtle</option>
                  <option value="balanced">Balanced</option>
                  <option value="bold">Bold</option>
                </Select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Font</span>
                <Select value={fontFamily} onChange={(event) => setFontFamily(event.target.value as FontFamilyId)}>
                  {(Object.keys(FONT_LABELS) as FontFamilyId[]).map((id) => (
                    <option key={id} value={id}>
                      {FONT_LABELS[id]}
                    </option>
                  ))}
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
                <Select value={position} onChange={(event) => setPosition(event.target.value as TextPosition)}>
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
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Highlight color</span>
                <input
                  type="color"
                  value={highlightColor}
                  onChange={(event) => setHighlightColor(event.target.value)}
                  className="h-10 w-full cursor-pointer rounded-xl border border-white/10 bg-black/20"
                />
              </label>
              <Range label="Text tilt" value={textRotation} min={-12} max={12} step={1} onChange={setTextRotation} format={(v) => `${v}°`} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={uppercase}
                  onChange={(event) => setUppercase(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                Uppercase text
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={Boolean(textColor)}
                  onChange={(event) => setTextColor(event.target.checked ? "#ffffff" : "")}
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                Custom text color
              </label>
              {textColor && (
                <input
                  type="color"
                  value={textColor}
                  onChange={(event) => setTextColor(event.target.value)}
                  className="h-8 w-12 cursor-pointer rounded-lg border border-white/10 bg-black/20"
                />
              )}
            </div>

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
                      index === paletteIndex % style.palettes.length
                        ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/40"
                        : "border-white/10 hover:border-white/30"
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
              Generate 4 variants
            </Button>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Call-outs</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Add circles, arrows, emoji, and number badges. Drag with the sliders.
            </p>
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
              <Badge>1280 × 720</Badge>
            </div>
            <canvas ref={previewRef} className="mt-4 aspect-video w-full rounded-2xl border border-white/10 bg-black/40" />

            <div className="mt-4 flex items-start gap-4">
              <div className="shrink-0">
                <span className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Mobile feed size</span>
                {smallPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={smallPreview}
                    alt="Small preview"
                    className="w-40 rounded-md border border-white/10"
                    style={{ aspectRatio: "16 / 9" }}
                  />
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
                <Select
                  value={String(exportScale)}
                  onChange={(event) => setExportScale(Number(event.target.value))}
                  className="h-9 w-auto px-2"
                >
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
                Set up your thumbnail on the left, then hit <span className="text-white">Generate 4 variants</span> to get A/B
                options with rotated palettes, emphasis, and layout.
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
                          onClick={() => downloadDataUrl(variant.png, exportName(`-${String.fromCharCode(97 + index)}.png`))}
                          className="rounded-lg bg-white/8 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/15"
                        >
                          PNG
                        </button>
                        <button
                          type="button"
                          title="Download JPEG"
                          onClick={() => downloadDataUrl(variant.jpeg, exportName(`-${String.fromCharCode(97 + index)}.jpg`))}
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
