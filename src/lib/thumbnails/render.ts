import { getStyle } from "@/lib/thumbnails/backgrounds";
import { getAppleEmojiImage } from "@/lib/thumbnails/emoji";
import { getFont, type FontOption } from "@/lib/thumbnails/fonts";
import { lineWidth, tokenizeHighlights, wrapTokens, type Line, type Token } from "@/lib/thumbnails/text";
import type { ImageLayer, Palette, Sticker, TextEmphasis, TextPosition, ThumbnailOptions, Transform } from "@/lib/thumbnails/types";
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

/**
 * Shrink-to-fit a tokenized text block at the requested font: returns the font
 * size and wrapped lines (cap of 3 lines, every line within `maxWidth`).
 */
function fitTokens(ctx: CanvasRenderingContext2D, tokens: Token[], baseSize: number, maxWidth: number, font: FontOption) {
  let fontSize = baseSize;
  let lines: Line[] = [];
  const measure = (text: string) => ctx.measureText(text).width;
  for (; fontSize >= 48; fontSize -= 6) {
    ctx.font = `${font.weight} ${fontSize}px ${font.stack}`;
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
  highlightColor: string
) {
  ctx.font = `${font.weight} ${fontSize}px ${font.stack}`;
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
      ctx.font = `${font.weight} ${fontSize}px ${font.stack}`;
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
  const { fontSize, lines } = fitTokens(ctx, tokens, SIZE_BASE[o.size], maxWidth, font);

  const lineHeight = fontSize * 1.14;
  const effectivePosition = hasSubjectImage && o.position === "center" ? "left" : o.position;
  const metrics = textBlockMetrics(effectivePosition, lines.length, lineHeight);

  ctx.textBaseline = "alphabetic";
  paintLines(ctx, lines, metrics.x, metrics.yStart, metrics.align, fontSize, palette, o.emphasis, font, o.textColor, o.highlightColor);
}

/** Free-placement text block: centered on its transform, optionally rotated. */
function drawTextLayer(ctx: CanvasRenderingContext2D, rawText: string, palette: Palette, o: ThumbnailOptions, font: FontOption) {
  const transform = o.textTransform;
  const tokens = tokenizeHighlights(rawText);
  const { fontSize, lines } = fitTokens(ctx, tokens, SIZE_BASE[o.size] * transform.scale, W * 0.8, font);
  const lineHeight = fontSize * 1.14;
  const blockHeight = lines.length * lineHeight;

  ctx.save();
  ctx.globalAlpha = effectiveOpacity(transform);
  ctx.translate(transform.x * W, transform.y * H);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.textBaseline = "alphabetic";
  const yStart = -blockHeight / 2 + lineHeight * 0.8;
  paintLines(ctx, lines, 0, yStart, "center", fontSize, palette, o.emphasis, font, o.textColor, o.highlightColor);
  ctx.restore();
}

/* ------------------------------ image drawing ----------------------------- */

function drawSubjectImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, palette: Palette) {
  // Panel mode: subject on the right ~45%, full height, with a soft fade into
  // the background on its left edge.
  const panelX = W * 0.55;
  const panelW = W - panelX;
  const baseScale = Math.max(panelW / image.width, H / image.height);
  const dw = image.width * baseScale;
  const dh = image.height * baseScale;
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

/**
 * Half-width/half-height of a sticker's bounding box at its current scale, kept
 * in sync with `drawSticker` so selection and hit-testing line up with the art.
 */
function stickerHalfExtents(s: Sticker): { halfW: number; halfH: number } {
  const scale = s.scale;
  switch (s.type) {
    case "circle":
      return { halfW: 158 * scale, halfH: 122 * scale };
    case "arrow":
      return { halfW: 112 * scale, halfH: 40 * scale };
    case "badge":
      return { halfW: 106 * scale, halfH: 106 * scale };
    case "emoji":
    default:
      return { halfW: (EMOJI_SIZE / 2) * scale, halfH: (EMOJI_SIZE / 2) * scale };
  }
}

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

/* -------------------------- layout & hit-testing -------------------------- */

/** Axis-aligned-in-local-space bounds of a layer, in canvas pixels. */
export type LayoutBox = {
  id: string;
  kind: "text" | "image" | "sticker";
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
    const h = IMAGE_BASE_WIDTH * effectiveScaleY(layer.transform) * aspect;
    boxes.push({
      id: layer.id,
      kind: "image",
      cx: layer.transform.x * W,
      cy: layer.transform.y * H,
      halfW: w / 2,
      halfH: h / 2,
      rotation: layer.transform.rotation
    });
  });

  const text = options.uppercase ? options.text.toUpperCase() : options.text;
  if (text.trim()) {
    const ctx = getMeasureCtx();
    const font = getFont(options.fontId);
    const tokens = tokenizeHighlights(text.trim());
    const { fontSize, lines } = fitTokens(ctx, tokens, SIZE_BASE[options.size] * options.textTransform.scale, W * 0.8, font);
    const lineHeight = fontSize * 1.14;
    ctx.font = `${font.weight} ${fontSize}px ${font.stack}`;
    const measure = (t: string) => ctx.measureText(t).width;
    const widest = Math.max(0, ...lines.map((line) => lineWidth(line, measure)));
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

  // Stickers sit on top of everything else, so they hit-test first.
  options.stickers.forEach((sticker) => {
    const { halfW, halfH } = stickerHalfExtents(sticker);
    boxes.push({
      id: sticker.id,
      kind: "sticker",
      cx: sticker.x * W,
      cy: sticker.y * H,
      halfW,
      halfH,
      rotation: sticker.rotation
    });
  });

  return boxes;
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

/** Pixels (canvas space) the rotation handle sits above the box's top edge. */
export const ROTATE_OFFSET = 46;
/** Hit radius (canvas space) around a corner/rotation handle. */
export const HANDLE_RADIUS = 22;

/** The four resize corners. */
export type Corner = "nw" | "ne" | "sw" | "se";
export type HandleHit = Corner | "rotate";

/** Local-space (unrotated, box-centered) positions of every handle. */
function handlePositions(box: LayoutBox): Record<HandleHit, { x: number; y: number }> {
  return {
    nw: { x: -box.halfW, y: -box.halfH },
    ne: { x: box.halfW, y: -box.halfH },
    sw: { x: -box.halfW, y: box.halfH },
    se: { x: box.halfW, y: box.halfH },
    rotate: { x: 0, y: -box.halfH - ROTATE_OFFSET }
  };
}

/** Transform a canvas-space point into the box's local (unrotated) frame. */
function toLocal(box: LayoutBox, px: number, py: number): { x: number; y: number } {
  const angle = (-box.rotation * Math.PI) / 180;
  const dx = px - box.cx;
  const dy = py - box.cy;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
}

/**
 * Renders the thumbnail plus interactive editing chrome (selection outline,
 * resize corners, and a rotation handle) for the selected layer. Returns the
 * layout for hit-testing.
 */
export function renderEditor(canvas: HTMLCanvasElement, options: ThumbnailOptions, selectedId: string | null): LayoutBox[] {
  renderThumbnail(canvas, options);
  const ctx = canvas.getContext("2d");
  const layout = computeLayout(options);
  if (!ctx) return layout;

  const selected = layout.find((box) => box.id === selectedId);
  if (selected) {
    const accent = "#7ee9f2";
    ctx.save();
    ctx.translate(selected.cx, selected.cy);
    ctx.rotate((selected.rotation * Math.PI) / 180);

    // Selection outline.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(-selected.halfW, -selected.halfH, selected.halfW * 2, selected.halfH * 2);
    ctx.setLineDash([]);

    // Rotation handle: a stalk rising from the top edge to a round grip.
    const rot = handlePositions(selected).rotate;
    ctx.beginPath();
    ctx.moveTo(0, -selected.halfH);
    ctx.lineTo(rot.x, rot.y);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rot.x, rot.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = "#0b0e08";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();

    // Resize corners.
    ctx.fillStyle = accent;
    for (const corner of ["nw", "ne", "sw", "se"] as Corner[]) {
      const p = handlePositions(selected)[corner];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  return layout;
}

/** Hit-test a canvas-space point against a layout box, accounting for rotation. */
export function hitTest(box: LayoutBox, px: number, py: number): boolean {
  const local = toLocal(box, px, py);
  return Math.abs(local.x) <= box.halfW && Math.abs(local.y) <= box.halfH;
}

/**
 * If `px`/`py` (canvas space) lands on one of the selected box's handles,
 * return which one; otherwise null. Used to start a resize or rotate gesture.
 */
export function hitTestHandle(box: LayoutBox, px: number, py: number): HandleHit | null {
  const local = toLocal(box, px, py);
  const handles = handlePositions(box);
  let best: HandleHit | null = null;
  let bestDist = HANDLE_RADIUS;
  for (const key of Object.keys(handles) as HandleHit[]) {
    const p = handles[key];
    const dist = Math.hypot(local.x - p.x, local.y - p.y);
    if (dist <= bestDist) {
      best = key;
      bestDist = dist;
    }
  }
  return best;
}

/* --------------------------------- variants ------------------------------- */

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

export function renderToDataUrl(options: ThumbnailOptions, format: "png" | "jpeg" = "png", scale = 1): string {
  const canvas = document.createElement("canvas");
  renderThumbnail(canvas, options, scale);
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
}

/**
 * Render the thumbnail at an explicit pixel size. The 1280×720 composition is
 * scaled to fill the requested dimensions, so the export matches the on-screen
 * preview exactly (at 16:9 it's pixel-proportional; other ratios stretch to fit).
 */
export function renderToSizedDataUrl(
  options: ThumbnailOptions,
  width: number,
  height: number,
  format: "png" | "jpeg" = "png"
): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported in this browser.");
  // Paint the composition full-res, then blit it scaled to the target size so
  // the export matches the preview regardless of the requested dimensions.
  const full = document.createElement("canvas");
  renderThumbnail(full, options, 2);
  ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
}
