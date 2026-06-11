"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, ImagePlus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { BACKGROUND_STYLES, getStyle } from "@/lib/thumbnails/backgrounds";
import { buildVariants, renderThumbnail, renderToDataUrl } from "@/lib/thumbnails/render";
import { overlayIdeas, titleTreatments } from "@/lib/thumbnails/suggestions";
import type { BackgroundStyleId, Intensity, TextEmphasis, TextPosition, TextSize, ThumbnailOptions } from "@/lib/thumbnails/types";
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

export function ThumbnailGeneratorPage() {
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [overlayText, setOverlayText] = useState("");
  const [styleId, setStyleId] = useState<BackgroundStyleId>("gradient");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [intensity, setIntensity] = useState<Intensity>("balanced");
  const [emphasis, setEmphasis] = useState<TextEmphasis>("outline");
  const [position, setPosition] = useState<TextPosition>("left");
  const [size, setSize] = useState<TextSize>("medium");
  const [uppercase, setUppercase] = useState(true);
  const [variants, setVariants] = useState<Variant[]>([]);

  const style = getStyle(styleId);
  const options: ThumbnailOptions = useMemo(
    () => ({ image, text: overlayText, style: styleId, paletteIndex, intensity, emphasis, position, size, uppercase }),
    [image, overlayText, styleId, paletteIndex, intensity, emphasis, position, size, uppercase]
  );

  // Live preview re-renders on every settings change.
  useEffect(() => {
    if (previewRef.current) {
      renderThumbnail(previewRef.current, options);
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
        description="Create scroll-stopping 1280×720 YouTube thumbnails from an uploaded image, a title, and a style preset — rendered locally in your browser."
      />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        {/* Left: controls */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold text-white">Source</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Optional — a face or product shot fills the right side of the thumbnail.
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
              <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
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
                placeholder="Thumbnail text (what appears on the image)"
                value={overlayText}
                onChange={(event) => setOverlayText(event.target.value)}
              />
            </div>
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
              <label className="flex items-end gap-2 pb-3 text-sm text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={uppercase}
                  onChange={(event) => setUppercase(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-black/20"
                />
                Uppercase text
              </label>
            </div>

            <div className="mt-4">
              <span className="mb-2 block text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Palette — {style.palettes[paletteIndex % style.palettes.length].name}
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

          {(ideas.length > 0 || treatments.length > 0) && (
            <Card>
              <h2 className="text-lg font-semibold text-white">Copy ideas</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Derived from your title — click to use as thumbnail text.</p>
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
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => downloadDataUrl(renderToDataUrl(options, "png"), exportName(".png"))}>
                <Download className="mr-2 h-4 w-4" />
                Download PNG
              </Button>
              <Button variant="secondary" onClick={() => downloadDataUrl(renderToDataUrl(options, "jpeg"), exportName(".jpg"))}>
                <Download className="mr-2 h-4 w-4" />
                Download JPEG
              </Button>
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
