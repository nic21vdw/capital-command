import { getStyle } from "@/lib/thumbnails/backgrounds";
import type { Palette, TextEmphasis, TextPosition, ThumbnailOptions } from "@/lib/thumbnails/types";
import { INTENSITY_FACTOR, THUMB_HEIGHT as H, THUMB_WIDTH as W } from "@/lib/thumbnails/types";

const FONT_STACK = '"Arial Black", "Segoe UI", system-ui, sans-serif';

const SIZE_BASE: Record<ThumbnailOptions["size"], number> = {
  small: 84,
  medium: 110,
  large: 144
};

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
  let fontSize = baseSize;
  let lines: string[] = [];

  // Shrink-to-fit: cap at 3 lines and make sure every line fits.
  for (; fontSize >= 48; fontSize -= 6) {
    ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
    lines = wrapText(ctx, text, maxWidth);
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (lines.length <= 3 && widest <= maxWidth) break;
  }

  const lineHeight = fontSize * 1.14;
  const effectivePosition = hasSubjectImage && position === "center" ? "left" : position;
  const metrics = textBlockMetrics(effectivePosition, lines.length, lineHeight);

  ctx.textAlign = metrics.align;
  ctx.textBaseline = "alphabetic";

  if (emphasis === "boxed") {
    // One translucent panel behind the whole block.
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const padX = 36;
    const padY = 28;
    const boxX = metrics.align === "center" ? metrics.x - widest / 2 - padX : metrics.x - padX;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(boxX, metrics.yStart - lineHeight * 0.8 - padY, widest + padX * 2, lines.length * lineHeight + padY * 2);
  }

  lines.forEach((line, index) => {
    const y = metrics.yStart + index * lineHeight;
    if (emphasis === "highlight-bar") {
      const width = ctx.measureText(line).width;
      const barX = metrics.align === "center" ? metrics.x - width / 2 - 18 : metrics.x - 18;
      ctx.fillStyle = palette.accent;
      ctx.fillRect(barX, y - fontSize * 0.82, width + 36, fontSize * 1.06);
    }
  });

  lines.forEach((line, index) => {
    const y = metrics.yStart + index * lineHeight;
    ctx.font = `900 ${fontSize}px ${FONT_STACK}`;
    if (emphasis === "outline") {
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(8, fontSize * 0.12);
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(line, metrics.x, y);
    }
    if (emphasis === "clean" || emphasis === "boxed") {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
    }
    // Highlight bars need contrast text; everything else uses the palette text.
    ctx.fillStyle = emphasis === "highlight-bar" ? contrastFor(palette.accent) : palette.text;
    ctx.fillText(line, metrics.x, y);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  });
}

function contrastFor(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#0b0e08" : "#ffffff";
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

  ctx.clearRect(0, 0, W, H);
  style.paint(ctx, palette, intensity, options.image);

  // Split-screen and blurred-frame consume the image inside the background.
  const subjectDrawn = Boolean(options.image) && !style.usesImageAsBackdrop && options.style !== "split-screen";
  if (options.image && subjectDrawn) {
    drawSubjectImage(ctx, options.image, palette);
  }

  const text = options.uppercase ? options.text.toUpperCase() : options.text;
  if (text.trim()) {
    drawText(
      ctx,
      text.trim(),
      palette,
      options.emphasis,
      options.position,
      SIZE_BASE[options.size],
      subjectDrawn || options.style === "split-screen"
    );
  }
}

export type VariantSpec = {
  label: string;
  options: ThumbnailOptions;
};

/** Builds four deterministic A/B variants of the current setup. */
export function buildVariants(base: ThumbnailOptions): VariantSpec[] {
  const style = getStyle(base.style);
  const paletteCount = style.palettes.length;
  const emphasisCycle: TextEmphasis[] = ["highlight-bar", "outline", "boxed", "clean"];
  const positionCycle: TextPosition[] = ["left", "bottom-left", "left", "bottom-left"];

  return [0, 1, 2, 3].map((i) => {
    const paletteIndex = (base.paletteIndex + i) % paletteCount;
    const emphasis = i === 0 ? base.emphasis : emphasisCycle[(emphasisCycle.indexOf(base.emphasis) + i) % emphasisCycle.length];
    return {
      label: `Variant ${String.fromCharCode(65 + i)} — ${style.palettes[paletteIndex].name}`,
      options: {
        ...base,
        paletteIndex,
        emphasis,
        position: i === 0 ? base.position : positionCycle[i]
      }
    };
  });
}

export function renderToDataUrl(options: ThumbnailOptions, format: "png" | "jpeg" = "png"): string {
  const canvas = document.createElement("canvas");
  renderThumbnail(canvas, options);
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
}
