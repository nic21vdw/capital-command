import type { CarouselAspectRatio, CarouselSlide, SlideLayer } from "@/types/domain";

/**
 * Canvas rendering for carousel slides. The same routine draws the small card
 * previews, the blown-up editor canvas, and the downloaded PNGs — so what you
 * edit is exactly what exports. Layer geometry is stored as fractions of the
 * slide (see SlideLayer), which lets one layout render at any aspect ratio or
 * pixel size.
 */

export type AspectRatioSpec = {
  id: CarouselAspectRatio;
  label: string;
  /** Short badge, e.g. "1080×1350". */
  badge: string;
  /** Aspect ratio "4:5" style label. */
  ratio: string;
  width: number;
  height: number;
  /** Where this frame is meant to be posted — shown as a hint. */
  hint: string;
};

export const ASPECT_RATIOS: Record<CarouselAspectRatio, AspectRatioSpec> = {
  portrait: { id: "portrait", label: "Portrait", badge: "1080×1350", ratio: "4:5", width: 1080, height: 1350, hint: "Instagram / Facebook feed" },
  square: { id: "square", label: "Square", badge: "1080×1080", ratio: "1:1", width: 1080, height: 1080, hint: "Feed / LinkedIn" },
  story: { id: "story", label: "Story / Reel", badge: "1080×1920", ratio: "9:16", width: 1080, height: 1920, hint: "Stories · Reels · TikTok · Shorts" },
  landscape: { id: "landscape", label: "Landscape", badge: "1920×1080", ratio: "16:9", width: 1920, height: 1080, hint: "YouTube / X" }
};

export const ASPECT_RATIO_LIST: AspectRatioSpec[] = Object.values(ASPECT_RATIOS);

export const DEFAULT_ASPECT_RATIO: CarouselAspectRatio = "portrait";

export function aspectSpec(ratio: CarouselAspectRatio | undefined): AspectRatioSpec {
  return ASPECT_RATIOS[ratio ?? DEFAULT_ASPECT_RATIO];
}

/**
 * CoLateral brand theme — a clean white/light canvas with blue accents. This
 * is the current provisional default (a fuller theme spec will land later);
 * every color the base chrome + default background use routes through here so
 * the theme can be swapped in one place.
 */
export const COLATERAL_THEME = {
  /** Background gradient (top-left → bottom-right). */
  bgFrom: "#ffffff",
  bgTo: "#e8f0ff",
  /** Soft blue glow bloomed into the top-right corner. */
  glow: "rgba(37,99,235,0.16)",
  /** Blue accent used for the counter chip + accent bar. */
  accent: "#2563eb",
  /** Default heading / body / counter ink on the light canvas. */
  heading: "#0f172a",
  body: "#475569",
  counter: "rgba(15,23,42,0.42)"
} as const;

/** The brand gradient background used when a slide has no override. */
export function paintDefaultBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, COLATERAL_THEME.bgFrom);
  bg.addColorStop(1, COLATERAL_THEME.bgTo);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.85, h * 0.1, 50, w * 0.85, h * 0.1, Math.max(w, h) * 0.6);
  glow.addColorStop(0, COLATERAL_THEME.glow);
  glow.addColorStop(1, "rgba(37,99,235,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, font: string, maxWidth: number): string[] {
  ctx.font = font;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Loads an image data URL into a decoded HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image failed to load"));
    image.src = src;
  });
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawImageLayer(ctx: CanvasRenderingContext2D, layer: Extract<SlideLayer, { type: "image" }>, img: HTMLImageElement, w: number, h: number) {
  const lx = layer.x * w;
  const ly = layer.y * h;
  const lw = layer.width * w;
  const lh = layer.height * h;
  ctx.save();
  if (layer.rotation) {
    ctx.translate(lx + lw / 2, ly + lh / 2);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-(lx + lw / 2), -(ly + lh / 2));
  }
  if (layer.radius) {
    roundedRectPath(ctx, lx, ly, lw, lh, layer.radius * Math.min(lw, lh));
    ctx.clip();
  }
  // "contain" shows the whole image (letterboxed — right for logos + PNGs with
  // transparency); "cover" fills the box, cropping overflow (right for photos).
  const fit = layer.fit ?? "cover";
  const scale = fit === "contain" ? Math.min(lw / img.width, lh / img.height) : Math.max(lw / img.width, lh / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, lx + (lw - dw) / 2, ly + (lh - dh) / 2, dw, dh);
  ctx.restore();
}

function drawTextLayer(ctx: CanvasRenderingContext2D, layer: Extract<SlideLayer, { type: "text" }>, w: number, h: number) {
  const fontPx = layer.fontSize * h;
  const font = `${layer.weight} ${fontPx}px system-ui, -apple-system, sans-serif`;
  const maxWidth = layer.width * w;
  const lines = wrapText(ctx, layer.text || "", font, maxWidth);
  const lineHeight = fontPx * 1.18;
  const lx = layer.x * w;
  let ly = layer.y * h + fontPx;
  ctx.save();
  if (layer.rotation) {
    const cx = lx + maxWidth / 2;
    const cy = layer.y * h + (lines.length * lineHeight) / 2;
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  ctx.font = font;
  ctx.fillStyle = layer.color;
  ctx.textAlign = layer.align;
  const anchorX = layer.align === "left" ? lx : layer.align === "right" ? lx + maxWidth : lx + maxWidth / 2;
  for (const line of lines) {
    ctx.fillText(line, anchorX, ly);
    ly += lineHeight;
  }
  ctx.restore();
}

/** Draws the channel base chrome (counter, heading, body, accent bar). */
function drawBaseText(ctx: CanvasRenderingContext2D, slide: CarouselSlide, index: number, total: number, w: number, h: number) {
  const scale = w / 1080;
  const margin = 80 * scale;

  // The band the copy is centered inside — the whole slide unless a photo has
  // claimed the top of it.
  const bandTop = (slide.textBand?.top ?? 0) * h;
  const bandBottom = (slide.textBand?.bottom ?? 1) * h;

  // Slide counter — under the photo rather than over it when there is one.
  ctx.fillStyle = COLATERAL_THEME.counter;
  ctx.font = `600 ${34 * scale}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(`${index + 1}/${total}`, w - margin - 0 * scale, bandTop + 100 * scale);

  const isHook = index === 0;
  const headingFont = `800 ${(isHook ? 92 : 72) * scale}px system-ui, -apple-system, sans-serif`;
  const bodyFont = `400 ${44 * scale}px system-ui, -apple-system, sans-serif`;
  const maxWidth = w - margin * 2;

  const headingLines = slide.heading ? wrapText(ctx, slide.heading, headingFont, maxWidth) : [];
  const bodyLines = slide.body ? wrapText(ctx, slide.body, bodyFont, maxWidth) : [];
  const headingLineH = (isHook ? 108 : 86) * scale;
  const bodyLineH = 62 * scale;
  const blockH = headingLines.length * headingLineH + (bodyLines.length ? 40 * scale + bodyLines.length * bodyLineH : 0);
  let y = bandTop + (bandBottom - bandTop - blockH) / 2 + (isHook ? 70 : 50) * scale;

  ctx.textAlign = "left";
  ctx.font = headingFont;
  ctx.fillStyle = slide.headingColor ?? COLATERAL_THEME.heading;
  for (const line of headingLines) {
    ctx.fillText(line, margin, y);
    y += headingLineH;
  }
  if (bodyLines.length) {
    y += 40 * scale;
    ctx.font = bodyFont;
    ctx.fillStyle = slide.bodyColor ?? COLATERAL_THEME.body;
    for (const line of bodyLines) {
      ctx.fillText(line, margin, y);
      y += bodyLineH;
    }
  }

  // Blue accent bar anchoring the bottom-left.
  ctx.fillStyle = COLATERAL_THEME.accent;
  ctx.fillRect(margin, h - 130 * scale, 90 * scale, 8 * scale);
}

/**
 * Which parts of a slide to paint. Defaults draw everything (the export path);
 * the editor uses these to split a slide across stacked canvases so image
 * layers can live as interactive DOM elements in the correct z-order.
 */
export type RenderSlideOptions = {
  /** Leave the canvas transparent instead of painting the background. */
  skipBackground?: boolean;
  skipImageLayers?: boolean;
  skipTextLayers?: boolean;
  skipBaseText?: boolean;
};

/**
 * Renders one slide into a fresh canvas at the given aspect ratio's full
 * resolution. Async because image layers must decode first.
 */
export async function renderSlideCanvas(
  slide: CarouselSlide,
  index: number,
  total: number,
  ratio: CarouselAspectRatio,
  options: RenderSlideOptions = {}
): Promise<HTMLCanvasElement> {
  const spec = aspectSpec(ratio);
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d")!;

  // Background: solid/gradient override or the brand default.
  if (!options.skipBackground) {
    if (slide.background) {
      ctx.fillStyle = slide.background;
      ctx.fillRect(0, 0, spec.width, spec.height);
    } else {
      paintDefaultBackground(ctx, spec.width, spec.height);
    }
  }

  // Image layers render under the base copy; text layers over it.
  if (!options.skipImageLayers) {
    const imageLayers = (slide.layers ?? []).filter((l): l is Extract<SlideLayer, { type: "image" }> => l.type === "image");
    const decoded = await Promise.all(
      imageLayers.map(async (layer) => ({ layer, img: await loadImage(layer.src).catch(() => null) }))
    );
    for (const { layer, img } of decoded) {
      if (img) drawImageLayer(ctx, layer, img, spec.width, spec.height);
    }
  }

  if (!options.skipBaseText && !slide.hideBaseText) drawBaseText(ctx, slide, index, total, spec.width, spec.height);

  if (!options.skipTextLayers) {
    for (const layer of slide.layers ?? []) {
      if (layer.type === "text") drawTextLayer(ctx, layer, spec.width, spec.height);
    }
  }

  return canvas;
}

/** Renders a slide and returns a PNG blob. */
export async function renderSlideBlob(
  slide: CarouselSlide,
  index: number,
  total: number,
  ratio: CarouselAspectRatio
): Promise<Blob> {
  const canvas = await renderSlideCanvas(slide, index, total, ratio);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas export failed");
  return blob;
}

export function carouselBaseName(title: string): string {
  return title.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").toLowerCase().slice(0, 40) || "carousel";
}

/** Renders one slide and triggers a browser download. */
export async function downloadSlide(
  slide: CarouselSlide,
  index: number,
  total: number,
  ratio: CarouselAspectRatio,
  baseName: string
) {
  const blob = await renderSlideBlob(slide, index, total, ratio);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${baseName}-${ratio}-slide-${String(index + 1).padStart(2, "0")}.png`;
  anchor.click();
  URL.revokeObjectURL(url);
}
