import { getStyle } from "@/lib/thumbnails/backgrounds";
import { getAppleEmojiImage } from "@/lib/thumbnails/emoji";
import { getFont, type FontOption } from "@/lib/thumbnails/fonts";
import { lineWidth, tokenizeHighlights, wrapTokens, type Line, type Token } from "@/lib/thumbnails/text";
import type { ImageLayer, Palette, Sticker, TextEmphasis, TextPosition, ThumbnailOptions } from "@/lib/thumbnails/types";
import { effectiveOpacity, effectiveScaleY, INTENSITY_FACTOR, THUMB_HEIGHT as H, THUMB_WIDTH as W } from "@/lib/thumbnails/types";

const SIZE_BASE: Record<ThumbnailOptions["size"], number> = {
  small: 84,
  medium: 110,
  large: 144
};

/** Natural width of an image layer at scale 1, before the user's scale. */
export const IMAGE_BASE_WIDTH = W * 0.42;

function contrastFor(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#0b0e08" : "#ffffff";
}

/* ------------------------------- text drawing ----------------------------- */

/** Optional bold/italic/underline styling applied to the whole text block. */
type TextStyle = { bold?: boolean; italic?: boolean; underline?: boolean };

/**
 * Build a canvas `font` shorthand honoring the block's bold/italic styling.
 * Bold lifts the font's natural weight (single-weight display faces get faux
 * bold from the browser); italic prepends the slanted style.
 */
function fontSpec(font: FontOption, fontSize: number, style?: TextStyle): string {
  const italic = style?.italic ? "italic " : "";
  const weight = style?.bold ? Math.max(font.weight, 800) : font.weight;
  return `${italic}${weight} ${fontSize}px ${font.stack}`;
}

/**
 * Shrink-to-fit a tokenized text block at the requested font: returns the font
 * size and wrapped lines (cap of 3 lines, every line within `maxWidth`).
 */
function fitTokens(ctx: CanvasRenderingContext2D, tokens: Token[], baseSize: number, maxWidth: number, font: FontOption, style?: TextStyle) {
  let fontSize = baseSize;
  let lines: Line[] = [];
  const measure = (text: string) => ctx.measureText(text).width;
  for (; fontSize >= 48; fontSize -= 6) {
    ctx.font = fontSpec(font, fontSize, style);
    lines = wrapTokens(tokens, maxWidth, measure);
    const widest = Math.max(0, ...lines.map((line) => lineWidth(line, measure)));
    if (lines.length <= 3 && widest <= maxWidth) break;
  }
  return { fontSize, lines };
}

/**
 * Paints already-wrapped lines starting at `anchorX`/`yStart`. `align` controls
 * whether `anchorX` is the left edge or the center of each line. Honors the
 * emphasis treatment, custom/auto text color, per-word highlight color, and the
 * chosen font. The caller sets up any translate/rotate beforehand.
 */
function paintLines(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  anchorX: number,
  yStart: number,
  align: "left" | "center",
  fontSize: number,
  palette: Palette,
  emphasis: TextEmphasis,
  font: FontOption,
  textColor: string,
  highlightColor: string,
  style?: TextStyle
) {
  ctx.font = fontSpec(font, fontSize, style);
  ctx.textAlign = "left";
  const space = ctx.measureText(" ").width;
  const lineHeight = fontSize * 1.14;
  const measure = (text: string) => ctx.measureText(text).width;

  // A custom color overrides the palette everywhere; "auto"/empty keeps the
  // original behavior (palette text, contrast text on highlight bars).
  const custom = Boolean(textColor) && textColor !== "auto";
  const mainColor = custom ? textColor : palette.text;

  if (emphasis === "boxed") {
    const widest = Math.max(0, ...lines.map((line) => lineWidth(line, measure, space)));
    const padX = 36;
    const padY = 28;
    const boxX = align === "center" ? anchorX - widest / 2 - padX : anchorX - padX;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(boxX, yStart - lineHeight * 0.8 - padY, widest + padX * 2, lines.length * lineHeight + padY * 2);
  }

  lines.forEach((line, index) => {
    const y = yStart + index * lineHeight;
    const lw = lineWidth(line, measure, space);
    const startX = align === "center" ? anchorX - lw / 2 : anchorX;

    if (emphasis === "highlight-bar") {
      ctx.fillStyle = palette.accent;
      ctx.fillRect(startX - 18, y - fontSize * 0.82, lw + 36, fontSize * 1.06);
    }

    let x = startX;
    for (const token of line) {
      ctx.font = fontSpec(font, fontSize, style);
      const tw = measure(token.text);

      if (emphasis === "outline") {
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(8, fontSize * 0.12);
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText(token.text, x, y);
      }
      if (emphasis === "clean" || emphasis === "boxed") {
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
      }

      if (token.highlight) {
        ctx.fillStyle = highlightColor || palette.accent;
      } else if (emphasis === "highlight-bar") {
        ctx.fillStyle = custom ? textColor : contrastFor(palette.accent);
      } else {
        ctx.fillStyle = mainColor;
      }
      ctx.fillText(token.text, x, y);

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      x += tw + space;
    }

    // Underline the full width of the line, just below the baseline. The stroke
    // is trimmed by the trailing space added after the last token.
    if (style?.underline && line.length > 0) {
      const endX = x - space;
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = Math.max(3, fontSize * 0.06);
      ctx.beginPath();
      ctx.moveTo(startX, y + fontSize * 0.16);
      ctx.lineTo(endX, y + fontSize * 0.16);
      ctx.stroke();
    }
  });
}

function textBlockMetrics(position: TextPosition, lineCount: number, lineHeight: number) {
  const blockHeight = lineCount * lineHeight;
  if (position === "center") {
    return { x: W / 2, yStart: (H - blockHeight) / 2 + lineHeight * 0.8, align: "center" as const, maxWidth: W * 0.86 };
  }
  if (position === "bottom-left") {
    return { x: 80, yStart: H - blockHeight - 60 + lineHeight * 0.8, align: "left" as const, maxWidth: W * 0.62 };
  }
  return { x: 80, yStart: (H - blockHeight) / 2 + lineHeight * 0.8, align: "left" as const, maxWidth: W * 0.62 };
}

/** Automatic, background-aware text layout (quick mode). */
function drawTextAuto(ctx: CanvasRenderingContext2D, rawText: string, palette: Palette, o: ThumbnailOptions, hasSubjectImage: boolean, font: FontOption) {
  const maxWidth = o.position === "center" && !hasSubjectImage ? W * 0.86 : W * 0.6 - 80;
  const tokens = tokenizeHighlights(rawText);
  const textStyle: TextStyle = { bold: o.bold, italic: o.italic, underline: o.underline };
  const { fontSize, lines } = fitTokens(ctx, tokens, SIZE_BASE[o.size], maxWidth, font, textStyle);

  const lineHeight = fontSize * 1.14;
  const effectivePosition = hasSubjectImage && o.position === "center" ? "left" : o.position;
  const metrics = textBlockMetrics(effectivePosition, lines.length, lineHeight);

  ctx.textBaseline = "alphabetic";
  paintLines(ctx, lines, metrics.x, metrics.yStart, metrics.align, fontSize, palette, o.emphasis, font, o.textColor, o.highlightColor, textStyle);
}

/** Free-placement text block: centered on its transform, optionally rotated. */
function drawTextLayer(ctx: CanvasRenderingContext2D, rawText: string, palette: Palette, o: ThumbnailOptions, font: FontOption) {
  const transform = o.textTransform;
  const tokens = tokenizeHighlights(rawText);
  const textStyle: TextStyle = { bold: o.bold, italic: o.italic, underline: o.underline };
  const { fontSize, lines } = fitTokens(ctx, tokens, SIZE_BASE[o.size] * transform.scale, W * 0.8, font, textStyle);
  const lineHeight = fontSize * 1.14;
  const blockHeight = lines.length * lineHeight;

  ctx.save();
  ctx.globalAlpha = effectiveOpacity(transform);
  ctx.translate(transform.x * W, transform.y * H);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.textBaseline = "alphabetic";
  const yStart = -blockHeight / 2 + lineHeight * 0.8;
  paintLines(ctx, lines, 0, yStart, "center", fontSize, palette, o.emphasis, font, o.textColor, o.highlightColor, textStyle);
  ctx.restore();
}

/* ------------------------------ image drawing ----------------------------- */

function drawSubjectImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, palette: Palette) {
  // Panel mode: subject on the right ~45%, full height, with a soft fade into
  // the background on its left edge.
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

/** A solid-color silhouette of the (alpha) image, used for strokes and glows. */
function silhouette(image: HTMLImageElement, color: string): HTMLCanvasElement {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(image, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }
  return canvas;
}

/**
 * Draw a movable image layer at its transform, applying its cut-out treatment
 * (backlight, flip, outer glow, stroke, drop shadow, and color grading). With
 * the default treatment this is just a soft-shadowed image.
 */
function drawImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer, palette: Palette) {
  const { transform: tr, treatment: tm } = layer;
  const aspect = layer.image.height / layer.image.width;
  const w = IMAGE_BASE_WIDTH * tr.scale;
  // Independent height when scaleY differs from scale; proportional otherwise.
  const h = IMAGE_BASE_WIDTH * effectiveScaleY(tr) * aspect;

  ctx.save();
  ctx.globalAlpha = effectiveOpacity(tr);
  ctx.translate(tr.x * W, tr.y * H);
  ctx.rotate((tr.rotation * Math.PI) / 180);

  // Radial accent pop behind the subject (symmetric, drawn before any flip).
  if (tm.backlight) {
    const radius = Math.max(w, h) * 0.6;
    const glow = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
    glow.addColorStop(0, palette.accent);
    glow.addColorStop(1, "transparent");
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = glow;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  }

  if (tm.flip) ctx.scale(-1, 1);
  const dx = -w / 2;
  const dy = -h / 2;

  // Outer glow: blurred accent silhouette behind the subject.
  if (tm.glow > 0) {
    const sil = silhouette(layer.image, palette.accent);
    ctx.save();
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 24 + tm.glow * 60;
    ctx.drawImage(sil, dx, dy, w, h);
    ctx.drawImage(sil, dx, dy, w, h);
    ctx.restore();
  }

  // Stroke: color silhouette stamped around a ring of offsets.
  if (tm.stroke > 0) {
    const sil = silhouette(layer.image, tm.strokeColor || "#ffffff");
    const step = tm.stroke;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      ctx.drawImage(sil, dx + Math.cos(angle) * step, dy + Math.sin(angle) * step, w, h);
    }
  }

  // The subject itself, with optional grading and a grounding drop shadow.
  ctx.save();
  if (tm.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 18;
  }
  ctx.filter = `saturate(${tm.saturate}) contrast(${tm.contrast}) brightness(${tm.brightness})`;
  ctx.drawImage(layer.image, dx, dy, w, h);
  ctx.restore();

  ctx.restore();
}

/* ----------------------------- sticker drawing ---------------------------- */

/** Box size of an emoji glyph at scale 1, in canvas pixels. */
const EMOJI_SIZE = 150;

function drawSticker(ctx: CanvasRenderingContext2D, s: Sticker) {
  const cx = s.x * W;
  const cy = s.y * H;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((s.rotation * Math.PI) / 180);
  const scale = s.scale;

  if (s.type === "circle") {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 14 * scale;
    ctx.beginPath();
    ctx.ellipse(0, 0, 150 * scale, 115 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.type === "arrow") {
    const len = 220 * scale;
    const head = 70 * scale;
    const shaft = 34 * scale;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.moveTo(-len / 2, -shaft / 2);
    ctx.lineTo(len / 2 - head, -shaft / 2);
    ctx.lineTo(len / 2 - head, -head / 2);
    ctx.lineTo(len / 2, 0);
    ctx.lineTo(len / 2 - head, head / 2);
    ctx.lineTo(len / 2 - head, shaft / 2);
    ctx.lineTo(-len / 2, shaft / 2);
    ctx.closePath();
    ctx.fill();
  } else if (s.type === "emoji") {
    const glyph = s.text || "🔥";
    const apple = getAppleEmojiImage(glyph);
    if (apple) {
      const size = EMOJI_SIZE * scale;
      ctx.drawImage(apple, -size / 2, -size / 2, size, size);
    } else {
      // Until the Apple image loads (or if it can't), use the platform emoji font.
      ctx.font = `${130 * scale}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, 0, 0);
    }
  } else if (s.type === "badge") {
    const radius = 100 * scale;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 8 * scale;
    ctx.stroke();
    const label = s.text || "NEW";
    ctx.fillStyle = contrastFor(s.color);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let fontSize = radius * 0.9;
    ctx.font = `900 ${fontSize}px "Arial Black", system-ui, sans-serif`;
    while (fontSize > 14 && ctx.measureText(label).width > radius * 1.6) {
      fontSize -= 4;
      ctx.font = `900 ${fontSize}px "Arial Black", system-ui, sans-serif`;
    }
    ctx.fillText(label, 0, 0);
  }

  ctx.restore();
}

/* ------------------------------- main render ------------------------------ */

/** Renders one 1280x720 thumbnail into the provided canvas (optionally scaled). */
export function renderThumbnail(canvas: HTMLCanvasElement, options: ThumbnailOptions, scale = 1) {
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported in this browser.");
  if (scale !== 1) ctx.scale(scale, scale);

  const style = getStyle(options.style);
  const palette = style.palettes[options.paletteIndex % style.palettes.length];
  const intensity = INTENSITY_FACTOR[options.intensity];
  const primary = options.images[0] ?? null;
  const font = getFont(options.fontId);

  ctx.clearRect(0, 0, W, H);
  style.paint(ctx, palette, intensity, primary?.image ?? null);

  const text = options.uppercase ? options.text.toUpperCase() : options.text;

  if (options.manualLayout) {
    // Free placement: every image and the text sit at their transforms.
    options.images.forEach((layer) => drawImageLayer(ctx, layer, palette));
    if (text.trim()) {
      drawTextLayer(ctx, text.trim(), palette, options, font);
    }
    for (const sticker of options.stickers) drawSticker(ctx, sticker);
    return;
  }

  // Automatic, background-aware layout (the quick mode). The first image is the
  // subject: a free cut-out when its treatment says so, otherwise the right panel.
  const cutout = Boolean(primary) && primary!.treatment.cutout;
  const panelDrawn = Boolean(primary) && !cutout && !style.usesImageAsBackdrop && options.style !== "split-screen";

  if (primary && cutout) {
    drawImageLayer(ctx, primary, palette);
  } else if (primary && panelDrawn) {
    drawSubjectImage(ctx, primary.image, palette);
  }

  const subjectOnRight = Boolean(primary) && (cutout || panelDrawn || options.style === "split-screen");
  if (text.trim()) {
    drawTextAuto(ctx, text.trim(), palette, options, subjectOnRight, font);
  }

  for (const sticker of options.stickers) drawSticker(ctx, sticker);
}

/** The four resize corners. */
export type Corner = "nw" | "ne" | "sw" | "se";

export function renderToDataUrl(options: ThumbnailOptions, format: "png" | "jpeg" = "png", scale = 1): string {
  const canvas = document.createElement("canvas");
  renderThumbnail(canvas, options, scale);
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
}
