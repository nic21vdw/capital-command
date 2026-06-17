import { getStyle } from "@/lib/thumbnails/backgrounds";
import type { ImageLayer, Palette, TextEmphasis, TextPosition, Transform, ThumbnailOptions } from "@/lib/thumbnails/types";
import { INTENSITY_FACTOR, THUMB_HEIGHT as H, THUMB_WIDTH as W } from "@/lib/thumbnails/types";

const FONT_STACK = '"Arial Black", "Segoe UI", system-ui, sans-serif';

const SIZE_BASE: Record<ThumbnailOptions["size"], number> = {
  small: 84,
  medium: 110,
  large: 144
};

/** Natural width of an image layer at scale 1, before the user's scale. */
const IMAGE_BASE_WIDTH = W * 0.42;

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawSubjectImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, palette: Palette) {
  // Subject panel on the right ~45%, full height, with a soft fade into the
  // background on its left edge and a grounding shadow.
  const panelX = W * 0.55;
  const panelW = W - panelX;
  const scale = Math.max(panelW / image.width, H / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(panelX, 0, panelW, H);
  ctx.clip();
  ctx.drawImage(image, panelX + (panelW - dw) / 2, (H - dh) / 2, dw, dh);
  const fade = ctx.createLinearGradient(panelX, 0, panelX + 160, 0);
  fade.addColorStop(0, palette.bg1);
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(panelX, 0, 160, H);
  ctx.restore();
}

function textBlockMetrics(position: TextPosition, lineCount: number, lineHeight: number) {
  const blockHeight = lineCount * lineHeight;
  if (position === "center") {
    return { x: W / 2, yStart: (H - blockHeight) / 2 + lineHeight * 0.8, align: "center" as CanvasTextAlign, maxWidth: W * 0.86 };
  }
  if (position === "bottom-left") {
    return { x: 80, yStart: H - blockHeight - 60 + lineHeight * 0.8, align: "left" as CanvasTextAlign, maxWidth: W * 0.62 };
  }
  return { x: 80, yStart: (H - blockHeight) / 2 + lineHeight * 0.8, align: "left" as CanvasTextAlign, maxWidth: W * 0.62 };
}

/** Shrink-to-fit a text block: returns the font size and wrapped lines. */
function fitText(ctx: CanvasRenderingContext2D, text: string, baseSize: number, maxWidth: number) {
  let fontSize = baseSize;
  let lines: string[] = [];
  for (; fontSize >= 48; fontSize -= 6) {
    ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
    lines = wrapText(ctx, text, maxWidth);
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (lines.length <= 3 && widest <= maxWidth) break;
  }
  return { fontSize, lines };
}

/** Paint a single wrapped line with the requested emphasis treatment. */
function paintLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  fontSize: number,
  palette: Palette,
  emphasis: TextEmphasis
) {
  ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = align;
  if (emphasis === "highlight-bar") {
    const width = ctx.measureText(line).width;
    const barX = align === "center" ? x - width / 2 - 18 : x - 18;
    ctx.fillStyle = palette.accent;
    ctx.fillRect(barX, y - fontSize * 0.82, width + 36, fontSize * 1.06);
  }
  if (emphasis === "outline") {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(8, fontSize * 0.12);
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.strokeText(line, x, y);
  }
  if (emphasis === "clean" || emphasis === "boxed") {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
  }
  ctx.fillStyle = emphasis === "highlight-bar" ? contrastFor(palette.accent) : palette.text;
  ctx.fillText(line, x, y);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  palette: Palette,
  emphasis: TextEmphasis,
  position: TextPosition,
  baseSize: number,
  hasSubjectImage: boolean
) {
  // When a subject occupies the right side, keep text in the left column.
  const maxWidth = position === "center" && !hasSubjectImage ? W * 0.86 : W * 0.6 - 80;
  const { fontSize, lines } = fitText(ctx, text, baseSize, maxWidth);

  const lineHeight = fontSize * 1.14;
  const effectivePosition = hasSubjectImage && position === "center" ? "left" : position;
  const metrics = textBlockMetrics(effectivePosition, lines.length, lineHeight);

  ctx.textAlign = metrics.align;
  ctx.textBaseline = "alphabetic";

  if (emphasis === "boxed") {
    ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const padX = 36;
    const padY = 28;
    const boxX = metrics.align === "center" ? metrics.x - widest / 2 - padX : metrics.x - padX;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(boxX, metrics.yStart - lineHeight * 0.8 - padY, widest + padX * 2, lines.length * lineHeight + padY * 2);
  }

  lines.forEach((line, index) => {
    const y = metrics.yStart + index * lineHeight;
    paintLine(ctx, line, metrics.x, y, metrics.align, fontSize, palette, emphasis);
  });
}

/** Draw a centered, optionally-rotated text block for manual layout. */
function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  text: string,
  palette: Palette,
  emphasis: TextEmphasis,
  baseSize: number,
  transform: Transform
) {
  const maxWidth = W * 0.8;
  const { fontSize, lines } = fitText(ctx, text, baseSize * transform.scale, maxWidth);
  const lineHeight = fontSize * 1.14;
  const blockHeight = lines.length * lineHeight;

  ctx.save();
  ctx.translate(transform.x * W, transform.y * H);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const yStart = -blockHeight / 2 + lineHeight * 0.8;

  if (emphasis === "boxed") {
    ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const padX = 36;
    const padY = 28;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(-widest / 2 - padX, yStart - lineHeight * 0.8 - padY, widest + padX * 2, blockHeight + padY * 2);
  }

  lines.forEach((line, index) => {
    paintLine(ctx, line, 0, yStart + index * lineHeight, "center", fontSize, palette, emphasis);
  });
  ctx.restore();
}

/** Draw a movable image layer at its transform with a soft drop shadow. */
function drawImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer) {
  const aspect = layer.image.height / layer.image.width;
  const w = IMAGE_BASE_WIDTH * layer.transform.scale;
  const h = w * aspect;

  ctx.save();
  ctx.translate(layer.transform.x * W, layer.transform.y * H);
  ctx.rotate((layer.transform.rotation * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.drawImage(layer.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function contrastFor(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#0b0e08" : "#ffffff";
}

/** Axis-aligned-in-local-space bounds of a layer, in canvas pixels. */
export type LayoutBox = {
  id: string;
  kind: "text" | "image";
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  rotation: number;
};

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    if (!canvas) throw new Error("Canvas is not available in this environment.");
    measureCtx = canvas.getContext("2d");
    if (!measureCtx) throw new Error("Canvas 2D is not supported in this browser.");
  }
  return measureCtx;
}

/**
 * Geometry of every movable layer in manual layout — images first (bottom),
 * text last (top). Used for both rendering order and hit-testing.
 */
export function computeLayout(options: ThumbnailOptions): LayoutBox[] {
  const boxes: LayoutBox[] = [];

  options.images.forEach((layer) => {
    const aspect = layer.image.height / layer.image.width;
    const w = IMAGE_BASE_WIDTH * layer.transform.scale;
    boxes.push({
      id: layer.id,
      kind: "image",
      cx: layer.transform.x * W,
      cy: layer.transform.y * H,
      halfW: w / 2,
      halfH: (w * aspect) / 2,
      rotation: layer.transform.rotation
    });
  });

  const text = options.uppercase ? options.text.toUpperCase() : options.text;
  if (text.trim()) {
    const ctx = getMeasureCtx();
    const { fontSize, lines } = fitText(ctx, text.trim(), SIZE_BASE[options.size] * options.textTransform.scale, W * 0.8);
    const lineHeight = fontSize * 1.14;
    ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    boxes.push({
      id: "text",
      kind: "text",
      cx: options.textTransform.x * W,
      cy: options.textTransform.y * H,
      halfW: widest / 2 + 24,
      halfH: (lines.length * lineHeight) / 2 + 16,
      rotation: options.textTransform.rotation
    });
  }

  return boxes;
}

/** Renders one 1280x720 thumbnail into the provided canvas. */
export function renderThumbnail(canvas: HTMLCanvasElement, options: ThumbnailOptions) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported in this browser.");

  const style = getStyle(options.style);
  const palette = style.palettes[options.paletteIndex % style.palettes.length];
  const intensity = INTENSITY_FACTOR[options.intensity];
  const primaryImage = options.images[0]?.image ?? null;

  ctx.clearRect(0, 0, W, H);
  style.paint(ctx, palette, intensity, primaryImage);

  const text = options.uppercase ? options.text.toUpperCase() : options.text;

  if (options.manualLayout) {
    // Free placement: every image and the text sit at their transforms.
    options.images.forEach((layer) => drawImageLayer(ctx, layer));
    if (text.trim()) {
      drawTextLayer(ctx, text.trim(), palette, options.emphasis, SIZE_BASE[options.size], options.textTransform);
    }
    return;
  }

  // Automatic, background-aware layout (the quick mode).
  const subjectDrawn = Boolean(primaryImage) && !style.usesImageAsBackdrop && options.style !== "split-screen";
  if (primaryImage && subjectDrawn) {
    drawSubjectImage(ctx, primaryImage, palette);
  }
  if (text.trim()) {
    drawText(ctx, text.trim(), palette, options.emphasis, options.position, SIZE_BASE[options.size], subjectDrawn || options.style === "split-screen");
  }
}

/**
 * Renders the thumbnail plus interactive editing chrome (selection outline and
 * transform handles) for the selected layer. Returns the layout for hit-testing.
 */
export function renderEditor(canvas: HTMLCanvasElement, options: ThumbnailOptions, selectedId: string | null): LayoutBox[] {
  renderThumbnail(canvas, options);
  const ctx = canvas.getContext("2d");
  const layout = computeLayout(options);
  if (!ctx) return layout;

  const selected = layout.find((box) => box.id === selectedId);
  if (selected) {
    ctx.save();
    ctx.translate(selected.cx, selected.cy);
    ctx.rotate((selected.rotation * Math.PI) / 180);
    ctx.strokeStyle = "#7ee9f2";
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(-selected.halfW, -selected.halfH, selected.halfW * 2, selected.halfH * 2);
    ctx.setLineDash([]);
    ctx.fillStyle = "#7ee9f2";
    for (const [hx, hy] of [
      [-selected.halfW, -selected.halfH],
      [selected.halfW, -selected.halfH],
      [-selected.halfW, selected.halfH],
      [selected.halfW, selected.halfH]
    ]) {
      ctx.beginPath();
      ctx.arc(hx, hy, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  return layout;
}

/** Hit-test a canvas-space point against a layout box, accounting for rotation. */
export function hitTest(box: LayoutBox, px: number, py: number): boolean {
  const angle = (-box.rotation * Math.PI) / 180;
  const dx = px - box.cx;
  const dy = py - box.cy;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(localX) <= box.halfW && Math.abs(localY) <= box.halfH;
}

export type VariantSpec = {
  label: string;
  options: ThumbnailOptions;
};

/** Small deterministic PRNG so generated variants are reproducible. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VARIANT_COUNT = 10;

/**
 * Builds ten variants of the current setup. The first keeps the user's layout;
 * the rest place the text and images at varied positions and rotations.
 */
export function buildVariants(base: ThumbnailOptions): VariantSpec[] {
  const style = getStyle(base.style);
  const paletteCount = style.palettes.length;
  const emphasisCycle: TextEmphasis[] = ["highlight-bar", "outline", "boxed", "clean"];

  return Array.from({ length: VARIANT_COUNT }, (_, i) => {
    const paletteIndex = (base.paletteIndex + i) % paletteCount;
    const emphasis = i === 0 ? base.emphasis : emphasisCycle[(emphasisCycle.indexOf(base.emphasis) + i) % emphasisCycle.length];

    if (i === 0) {
      return {
        label: `Variant A — ${style.palettes[paletteIndex].name}`,
        options: { ...base, paletteIndex, emphasis }
      };
    }

    const rand = mulberry32(i * 101 + 7);
    const between = (min: number, max: number) => min + rand() * (max - min);

    const textTransform: Transform = {
      x: between(0.24, 0.5),
      y: between(0.22, 0.78),
      scale: between(0.85, 1.25),
      rotation: rand() < 0.45 ? between(-9, 9) : 0
    };

    const images = base.images.map((layer, index) => ({
      ...layer,
      transform: {
        x: between(0.45, 0.92),
        y: between(0.2, 0.82),
        scale: between(0.45, 1) * (index === 0 ? 1.1 : 1),
        rotation: between(-14, 14)
      }
    }));

    return {
      label: `Variant ${String.fromCharCode(65 + i)} — ${style.palettes[paletteIndex].name}`,
      options: { ...base, paletteIndex, emphasis, manualLayout: true, textTransform, images }
    };
  });
}

export function renderToDataUrl(options: ThumbnailOptions, format: "png" | "jpeg" = "png"): string {
  const canvas = document.createElement("canvas");
  renderThumbnail(canvas, options);
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
}
