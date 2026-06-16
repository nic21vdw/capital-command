import { getStyle } from "@/lib/thumbnails/backgrounds";
import { lineWidth, tokenizeHighlights, wrapTokens, type Line } from "@/lib/thumbnails/text";
import type { Palette, Sticker, TextPosition, ThumbnailOptions } from "@/lib/thumbnails/types";
import { FONT_STACKS, INTENSITY_FACTOR, THUMB_HEIGHT as H, THUMB_WIDTH as W } from "@/lib/thumbnails/types";

const SIZE_BASE: Record<ThumbnailOptions["size"], number> = {
  small: 84,
  medium: 110,
  large: 144
};

/* ----------------------------- subject drawing ---------------------------- */

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

function drawSubjectCutout(ctx: CanvasRenderingContext2D, image: HTMLImageElement, palette: Palette, o: ThumbnailOptions) {
  const dh = H * o.subjectScale;
  const dw = (image.width / image.height) * dh;
  const cx = W * 0.68 + o.subjectX * (W * 0.5);
  const cy = H * 0.52 + o.subjectY * (H * 0.5);

  // Radial accent pop behind the subject (drawn in canvas space, no flip).
  if (o.subjectBacklight) {
    const radius = Math.max(dw, dh) * 0.6;
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
    glow.addColorStop(0, palette.accent);
    glow.addColorStop(1, "transparent");
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(cx, cy);
  if (o.subjectFlip) ctx.scale(-1, 1);
  const dx = -dw / 2;
  const dy = -dh / 2;

  // Outer glow: blurred accent silhouette behind the subject.
  if (o.subjectGlow > 0) {
    const sil = silhouette(image, palette.accent);
    ctx.save();
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 24 + o.subjectGlow * 60;
    ctx.drawImage(sil, dx, dy, dw, dh);
    ctx.drawImage(sil, dx, dy, dw, dh);
    ctx.restore();
  }

  // Stroke: color silhouette stamped around a ring of offsets.
  if (o.subjectStroke > 0) {
    const sil = silhouette(image, o.subjectStrokeColor || "#ffffff");
    const step = o.subjectStroke;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      ctx.drawImage(sil, dx + Math.cos(angle) * step, dy + Math.sin(angle) * step, dw, dh);
    }
  }

  // The subject itself, with optional grading and a grounding drop shadow.
  ctx.save();
  if (o.subjectShadow) {
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 18;
  }
  ctx.filter = `saturate(${o.saturate}) contrast(${o.contrast}) brightness(${o.brightness})`;
  ctx.drawImage(image, dx, dy, dw, dh);
  ctx.restore();

  ctx.restore();
}

/* ------------------------------- text drawing ----------------------------- */

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

function contrastFor(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#0b0e08" : "#ffffff";
}

function drawText(ctx: CanvasRenderingContext2D, rawText: string, palette: Palette, o: ThumbnailOptions, hasSubjectImage: boolean) {
  const fontStack = FONT_STACKS[o.fontFamily] ?? FONT_STACKS["arial-black"];
  const maxWidth = o.position === "center" && !hasSubjectImage ? W * 0.86 : W * 0.6 - 80;
  const tokens = tokenizeHighlights(rawText);

  let fontSize = SIZE_BASE[o.size];
  let lines: Line[] = [];
  const measure = (text: string) => ctx.measureText(text).width;

  // Shrink-to-fit: cap at 3 lines and keep every line within the column.
  for (; fontSize >= 48; fontSize -= 6) {
    ctx.font = `900 ${fontSize}px ${fontStack}`;
    lines = wrapTokens(tokens, maxWidth, measure);
    const widest = Math.max(0, ...lines.map((line) => lineWidth(line, measure)));
    if (lines.length <= 3 && widest <= maxWidth) break;
  }

  const lineHeight = fontSize * 1.14;
  const effectivePosition = hasSubjectImage && o.position === "center" ? "left" : o.position;
  const metrics = textBlockMetrics(effectivePosition, lines.length, lineHeight);
  const space = ctx.measureText(" ").width;
  const mainColor = o.textColor || palette.text;

  ctx.save();
  // Whole-block tilt, pivoting on the block anchor.
  if (o.textRotation) {
    const rad = (o.textRotation * Math.PI) / 180;
    ctx.translate(metrics.x, metrics.yStart);
    ctx.rotate(rad);
    ctx.translate(-metrics.x, -metrics.yStart);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (o.emphasis === "boxed") {
    const widest = Math.max(0, ...lines.map((line) => lineWidth(line, measure, space)));
    const padX = 36;
    const padY = 28;
    const boxX = metrics.align === "center" ? metrics.x - widest / 2 - padX : metrics.x - padX;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(boxX, metrics.yStart - lineHeight * 0.8 - padY, widest + padX * 2, lines.length * lineHeight + padY * 2);
  }

  lines.forEach((line, index) => {
    const y = metrics.yStart + index * lineHeight;
    const lw = lineWidth(line, measure, space);
    const startX = metrics.align === "center" ? metrics.x - lw / 2 : metrics.x;

    if (o.emphasis === "highlight-bar") {
      ctx.fillStyle = palette.accent;
      ctx.fillRect(startX - 18, y - fontSize * 0.82, lw + 36, fontSize * 1.06);
    }

    let x = startX;
    for (const token of line) {
      ctx.font = `900 ${fontSize}px ${fontStack}`;
      const tw = measure(token.text);

      if (o.emphasis === "outline") {
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(8, fontSize * 0.12);
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText(token.text, x, y);
      }
      if (o.emphasis === "clean" || o.emphasis === "boxed") {
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
      }

      if (token.highlight) {
        ctx.fillStyle = o.highlightColor || palette.accent;
      } else if (o.emphasis === "highlight-bar") {
        ctx.fillStyle = contrastFor(palette.accent);
      } else {
        ctx.fillStyle = mainColor;
      }
      ctx.fillText(token.text, x, y);

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      x += tw + space;
    }
  });

  ctx.restore();
}

/* ----------------------------- sticker drawing ---------------------------- */

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
    ctx.font = `${130 * scale}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.text || "🔥", 0, 0);
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
    ctx.font = `900 ${fontSize}px ${FONT_STACKS.impact}`;
    while (fontSize > 14 && ctx.measureText(label).width > radius * 1.6) {
      fontSize -= 4;
      ctx.font = `900 ${fontSize}px ${FONT_STACKS.impact}`;
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

  ctx.clearRect(0, 0, W, H);
  style.paint(ctx, palette, intensity, options.image);

  const cutout = options.subjectMode === "cutout";
  // Panel mode skips styles that already consume the image as a backdrop.
  const panelDrawn = Boolean(options.image) && !cutout && !style.usesImageAsBackdrop && options.style !== "split-screen";

  if (options.image && cutout) {
    drawSubjectCutout(ctx, options.image, palette, options);
  } else if (options.image && panelDrawn) {
    drawSubjectImage(ctx, options.image, palette);
  }

  // Keep text in the left column when a subject occupies the right side.
  const subjectOnRight = Boolean(options.image) && (cutout ? options.subjectX >= -0.2 : panelDrawn || options.style === "split-screen");

  const text = options.uppercase ? options.text.toUpperCase() : options.text;
  if (text.trim()) {
    drawText(ctx, text.trim(), palette, options, subjectOnRight);
  }

  for (const sticker of options.stickers) {
    drawSticker(ctx, sticker);
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
  const emphasisCycle: ThumbnailOptions["emphasis"][] = ["highlight-bar", "outline", "boxed", "clean"];
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

export function renderToDataUrl(options: ThumbnailOptions, format: "png" | "jpeg" = "png", scale = 1): string {
  const canvas = document.createElement("canvas");
  renderThumbnail(canvas, options, scale);
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
}
