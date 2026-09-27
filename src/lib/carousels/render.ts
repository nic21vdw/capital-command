import { appleEmojiUrls, emojiImageKey, emojiIn, splitRuns } from "@/lib/emoji/apple";
import { emphasisWords, type EmphasisPiece } from "@/lib/carousels/emphasis";
import type { CarouselAspectRatio, CarouselSlide, CreatorSignature, SlideLayer } from "@/types/domain";

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

/**
 * The slice of a 2D context the slide painter uses. Structural rather than
 * `CanvasRenderingContext2D` so the same painting code runs against the
 * browser's canvas and the server's — the deck the pipeline books has to be the
 * deck the editor shows, and two copies of this layout would drift apart.
 */
type SlideGradient = { addColorStop(offset: number, color: string): void };

export interface SlideContext {
  font: string;
  fillStyle: unknown;
  textAlign: unknown;
  filter?: string;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  closePath(): void;
  clip(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SlideGradient;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SlideGradient;
}

/** A decoded picture, whatever decoded it. */
export type SlideImage = { width: number; height: number };

/**
 * The typeface every slide is set in. Arial by name, with the metric-compatible
 * substitutes behind it so a machine without Arial still lays the copy out the
 * same width. The editor's live-editing overlay uses the same stack, so what is
 * dragged is what exports.
 */
export const SLIDE_FONT_STACK = "Inter, Arial, Helvetica, 'Liberation Sans', Arimo, sans-serif";

export const SLIDE_FONT_WEIGHTS = [500, 700, 800, 900] as const;

export const COLATERAL_SITE = "colateralai.com";

export const DEFAULT_ASPECT_RATIO: CarouselAspectRatio = "portrait";

export function aspectSpec(ratio: CarouselAspectRatio | undefined): AspectRatioSpec {
  return ASPECT_RATIOS[ratio ?? DEFAULT_ASPECT_RATIO];
}

export const COLATERAL_THEME = {
  bgFrom: "#06101d",
  bgTo: "#0b2442",
  glow: "rgba(0,120,212,0.42)",
  glowSoft: "rgba(77,166,255,0.12)",
  grid: "rgba(148,197,255,0.11)",
  accent: "#4da6ff",
  accentDeep: "#0078d4",
  strong: "#9fd2ff",
  heading: "#ffffff",
  body: "rgba(222,234,248,0.86)",
  counter: "rgba(222,234,248,0.62)",
  chip: "rgba(6,16,29,0.8)",
  track: "rgba(222,234,248,0.18)",
  siteFill: "rgba(77,166,255,0.18)"
} as const;

export function paintDefaultBackground(ctx: SlideContext, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, COLATERAL_THEME.bgFrom);
  bg.addColorStop(1, COLATERAL_THEME.bgTo);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const scale = w / 1080;
  const step = 44 * scale;
  const dot = Math.max(1, 2.4 * scale);
  ctx.fillStyle = COLATERAL_THEME.grid;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  }
  const glow = ctx.createRadialGradient(w * 0.9, h * 0.04, 40 * scale, w * 0.9, h * 0.04, Math.max(w, h) * 0.62);
  glow.addColorStop(0, COLATERAL_THEME.glow);
  glow.addColorStop(1, "rgba(0,120,212,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  const low = ctx.createRadialGradient(w * 0.05, h, 20 * scale, w * 0.05, h, Math.max(w, h) * 0.55);
  low.addColorStop(0, COLATERAL_THEME.glowSoft);
  low.addColorStop(1, "rgba(77,166,255,0)");
  ctx.fillStyle = low;
  ctx.fillRect(0, 0, w, h);
}

/**
 * How wide an emoji picture is drawn, and how it sits on the line, as fractions
 * of the font size. Square at roughly cap height, dropped so its middle lands
 * where the middle of a capital does — an emoji aligned on the baseline reads as
 * a character that has fallen off the line.
 */
const EMOJI_SIZE = 1.02;
const EMOJI_BASELINE_DROP = 0.8;
/** A hair of air after the picture, which the PNG's own bounds do not carry. */
const EMOJI_ADVANCE = EMOJI_SIZE * 1.06;

/**
 * How wide a piece of copy is once its emoji are pictures rather than glyphs.
 * `measureText` answers for a glyph nothing will draw, so asking it about the
 * whole string is how a heading full of emoji wrapped a word early on Nic's
 * machine and not at all on the server.
 */
function measureRuns(ctx: SlideContext, text: string, fontPx: number): number {
  let width = 0;
  for (const run of splitRuns(text)) {
    width += run.emoji ? fontPx * EMOJI_ADVANCE : ctx.measureText(run.text).width;
  }
  return width;
}

/**
 * Draws copy from `x` rightwards, swapping each emoji for its Apple picture.
 * Falls back to `fillText` for a glyph whose picture never arrived, so a slide
 * is never held up by a missing download.
 */
function fillRuns(
  ctx: SlideContext,
  text: string,
  x: number,
  y: number,
  fontPx: number,
  images: Map<string, SlideImage | null> | undefined
) {
  const size = fontPx * EMOJI_SIZE;
  let cursor = x;
  for (const run of splitRuns(text)) {
    if (!run.emoji) {
      ctx.fillText(run.text, cursor, y);
      cursor += ctx.measureText(run.text).width;
      continue;
    }
    const picture = images?.get(emojiImageKey(run.text));
    if (picture) ctx.drawImage(picture, cursor, y - size * EMOJI_BASELINE_DROP, size, size);
    else ctx.fillText(run.text, cursor, y);
    cursor += fontPx * EMOJI_ADVANCE;
  }
}

function wrapText(ctx: SlideContext, text: string, font: string, maxWidth: number, fontPx: number): string[] {
  ctx.font = font;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureRuns(ctx, candidate, fontPx) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Where a line starts, given where the block is anchored. Emoji are painted one
 * piece at a time from a left edge, so an aligned line has to be measured and
 * placed rather than handed to `textAlign`.
 */
function lineStart(ctx: SlideContext, text: string, fontPx: number, align: string, left: number, width: number): number {
  if (align === "left") return left;
  const run = measureRuns(ctx, text, fontPx);
  return align === "right" ? left + width - run : left + (width - run) / 2;
}

/**
 * Decoded images, kept by source. A deck of photo slides is repainted on every
 * data refresh and every aspect-ratio change; without this, each repaint waits
 * on a fresh decode per slide and the photos pop in long after the copy.
 */
const decoded = new Map<string, Promise<HTMLImageElement>>();
/** Enough for a deck of photo slides several times over. Editor drops are data
 * URLs and would otherwise grow the map without bound. */
const DECODED_LIMIT = 120;

/** Loads an image data URL into a decoded HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = decoded.get(src);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image failed to load"));
    image.src = src;
  });
  pending.catch(() => decoded.delete(src));
  if (decoded.size >= DECODED_LIMIT) decoded.delete(decoded.keys().next().value!);
  decoded.set(src, pending);
  return pending;
}

/**
 * Emoji URLs that are not there. An ordinary picture forgets a failure so a
 * transient error can retry, but an emoji URL is content-addressed and its 404
 * is permanent — and most glyphs miss their first candidate name by design. The
 * editor repaints on every keystroke and every drag frame, so without this an
 * editing session fires two 404s per affected glyph per repaint.
 */
const missingEmoji = new Set<string>();

function fetchEmojiImage(url: string): Promise<HTMLImageElement> {
  if (missingEmoji.has(url)) return Promise.reject(new Error("emoji not in the set"));
  const cached = decoded.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    // Without this the export silently stops being able to produce a blob at
    // all: one tainted canvas and `toBlob` returns null for the whole slide.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("emoji failed to load"));
    image.src = url;
  });
  pending.catch(() => {
    decoded.delete(url);
    // An offline moment is not a missing file, and remembering it as one would
    // blank that emoji for the rest of the session.
    if (navigator.onLine !== false) missingEmoji.add(url);
  });
  decoded.set(url, pending);
  return pending;
}

/**
 * An Apple emoji picture for the browser canvas, or null if neither name the
 * image set might file it under could be fetched.
 */
async function loadEmojiImage(glyph: string): Promise<HTMLImageElement | null> {
  for (const url of appleEmojiUrls(glyph)) {
    const image = await fetchEmojiImage(url).catch(() => null);
    if (image) return image;
  }
  return null;
}

function roundedRectPath(ctx: SlideContext, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawImageLayer(
  ctx: SlideContext,
  layer: Extract<SlideLayer, { type: "image" }>,
  img: SlideImage,
  w: number,
  h: number,
  bandTop = 1
) {
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
  // transparency); "cover" fills the box, cropping overflow (right for photos);
  // "frame" is both — the whole picture over a blurred fill of itself.
  const fit = layer.fit ?? "cover";
  if (fit === "frame") {
    paintCover(ctx, img, lx, ly, lw, lh, BACKDROP_BLUR_PX * Math.min(lw, lh));
    paintContain(ctx, img, lx, ly, lw, lh, FRAME_POSITION, frameZoom(img, lw, lh, ly, bandTop * h));
  } else if (fit === "contain") {
    paintContain(ctx, img, lx, ly, lw, lh);
  } else {
    paintCover(ctx, img, lx, ly, lw, lh);
  }
  ctx.restore();
}

/** Blur radius of the bed a framed still sits on, as a fraction of the box. */
const BACKDROP_BLUR_PX = 0.055;

/**
 * Where a framed still sits in its box, read exactly as CSS `object-position`
 * reads it: the fraction of the LEFTOVER space that goes above the picture.
 * Zero — the picture is flush with the top of the slide. A widescreen still in
 * a 4:5 frame is far shorter than the slide it sits in, so anything above zero
 * opens a band of blurred nothing across the top before the picture starts.
 *
 * The editor's DOM overlay is given the same number as an `object-position`, so
 * what is dragged is still what exports.
 */
export const FRAME_POSITION = 0;

/**
 * How much bigger than `contain` a framed still is drawn. A 16:9 frame fitted
 * inside a 4:5 slide is limited by its width, so it stops well short of the
 * copy band and the slide reads as a small picture floating on a blur. Ten per
 * cent closes that, at the cost of five per cent off each side — and the sides
 * of a stream frame are the desk and the wall, not the middle of the shot.
 *
 * The editor scales its overlay by the same factor from the same origin.
 */
export const FRAME_ZOOM = 1.1;

/**
 * How much the still actually grows: up to FRAME_ZOOM, but never past the top
 * of the copy band, and never below the size it fits at.
 *
 * The cap is what keeps one layout serving every frame. At 4:5 and 9:16 a
 * widescreen still has room to spare above the copy and takes the full zoom; at
 * 1:1 it does not, and takes what is there. A 16:9 slide has no room at all —
 * the still already fills it — so the floor leaves that case exactly as it was.
 */
function frameZoom(img: SlideImage, lw: number, lh: number, ly: number, bandTop: number): number {
  const contained = img.height * Math.min(lw / img.width, lh / img.height);
  if (contained <= 0) return 1;
  const room = bandTop - ly - contained * FRAME_POSITION;
  return Math.max(1, Math.min(FRAME_ZOOM, room / contained));
}

function paintContain(
  ctx: SlideContext,
  img: SlideImage,
  lx: number,
  ly: number,
  lw: number,
  lh: number,
  position = 0.5,
  zoom = 1
) {
  const scale = Math.min(lw / img.width, lh / img.height) * zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, lx + (lw - dw) / 2, ly + (lh - dh) * position, dw, dh);
}

/**
 * Fills the box, cropping the overflow. `blur` paints it as a bed for something
 * else: the picture is also drawn PROUD of the box by the blur radius, because a
 * blur samples outside the source and would otherwise fade the slide's own edges
 * out to nothing.
 */
function paintCover(ctx: SlideContext, img: SlideImage, lx: number, ly: number, lw: number, lh: number, blur = 0) {
  const bleed = blur * 2;
  const bw = lw + bleed * 2;
  const bh = lh + bleed * 2;
  const scale = Math.max(bw / img.width, bh / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  if (blur) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.arcTo(lx + lw, ly, lx + lw, ly + lh, 0);
    ctx.arcTo(lx + lw, ly + lh, lx, ly + lh, 0);
    ctx.arcTo(lx, ly + lh, lx, ly, 0);
    ctx.closePath();
    ctx.clip();
    ctx.filter = `blur(${blur.toFixed(2)}px)`;
  }
  ctx.drawImage(img, lx - bleed + (bw - dw) / 2, ly - bleed + (bh - dh) / 2, dw, dh);
  if (blur) ctx.restore();
}

function drawTextLayer(
  ctx: SlideContext,
  layer: Extract<SlideLayer, { type: "text" }>,
  w: number,
  h: number,
  images: Map<string, SlideImage | null> | undefined
) {
  const fontPx = layer.fontSize * h;
  const font = `${layer.weight} ${fontPx}px ${SLIDE_FONT_STACK}`;
  const maxWidth = layer.width * w;
  const lines = wrapText(ctx, layer.text || "", font, maxWidth, fontPx);
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
  ctx.textAlign = "left";
  for (const line of lines) {
    fillRuns(ctx, line, lineStart(ctx, line, fontPx, layer.align, lx, maxWidth), ly, fontPx, images);
    ly += lineHeight;
  }
  ctx.restore();
}

function paintScrim(ctx: SlideContext, strength: number, w: number, h: number) {
  const veil = Math.max(0, Math.min(1, strength));
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, `rgba(6,16,29,${(veil * 0.34).toFixed(3)})`);
  gradient.addColorStop(0.42, `rgba(6,16,29,${(veil * 0.5).toFixed(3)})`);
  gradient.addColorStop(0.6, `rgba(6,16,29,${Math.min(0.94, veil * 1.62).toFixed(3)})`);
  gradient.addColorStop(1, `rgba(6,16,29,${Math.min(0.98, veil * 1.85).toFixed(3)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

const MIN_COPY_SCALE = 0.62;

type CopyWord = EmphasisPiece[];
type CopyLine = CopyWord[];
type CopySegment = { text: string; strong: boolean };
type CopyStyle = { px: number; regular: string; strong: string };

function copyStyle(px: number, regularWeight: number, strongWeight: number): CopyStyle {
  return {
    px,
    regular: `${regularWeight} ${px}px ${SLIDE_FONT_STACK}`,
    strong: `${strongWeight} ${px}px ${SLIDE_FONT_STACK}`
  };
}

function lineSegments(line: CopyLine): CopySegment[] {
  const segments: CopySegment[] = [];
  line.forEach((word, wordIndex) => {
    word.forEach((piece, pieceIndex) => {
      const text = (wordIndex > 0 && pieceIndex === 0 ? " " : "") + piece.text;
      const last = segments[segments.length - 1];
      if (last && last.strong === piece.strong) last.text += text;
      else segments.push({ text, strong: piece.strong });
    });
  });
  return segments;
}

function measureLine(ctx: SlideContext, line: CopyLine, style: CopyStyle): number {
  let width = 0;
  for (const segment of lineSegments(line)) {
    ctx.font = segment.strong ? style.strong : style.regular;
    width += measureRuns(ctx, segment.text, style.px);
  }
  return width;
}

function wrapCopy(ctx: SlideContext, text: string, style: CopyStyle, maxWidth: number): CopyLine[] {
  const lines: CopyLine[] = [];
  let line: CopyLine = [];
  for (const word of emphasisWords(text)) {
    const candidate = [...line, word];
    if (line.length && measureLine(ctx, candidate, style) > maxWidth) {
      lines.push(line);
      line = [word];
    } else {
      line = candidate;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawCopyLine(
  ctx: SlideContext,
  line: CopyLine,
  x: number,
  y: number,
  style: CopyStyle,
  colors: { regular: string; strong: string },
  images: Map<string, SlideImage | null> | undefined
) {
  let cursor = x;
  for (const segment of lineSegments(line)) {
    ctx.font = segment.strong ? style.strong : style.regular;
    ctx.fillStyle = segment.strong ? colors.strong : colors.regular;
    fillRuns(ctx, segment.text, cursor, y, style.px, images);
    cursor += measureRuns(ctx, segment.text, style.px);
  }
}

type SlideRole = "hook" | "middle" | "cta";

function slideRole(index: number, total: number): SlideRole {
  if (index === 0) return "hook";
  return index === total - 1 && total > 1 ? "cta" : "middle";
}

const HEADING_PX: Record<SlideRole, number> = { hook: 98, middle: 76, cta: 82 };

function fitCopy(
  ctx: SlideContext,
  slide: CarouselSlide,
  role: SlideRole,
  scale: number,
  maxWidth: number,
  bandH: number
) {
  let shrink = 1;
  for (let attempt = 0; ; attempt += 1) {
    const heading = copyStyle(HEADING_PX[role] * scale * shrink, 800, 900);
    const body = copyStyle(42 * scale * shrink, 500, 800);
    const headingLines = slide.heading ? wrapCopy(ctx, slide.heading, heading, maxWidth) : [];
    const bodyLines = slide.body ? wrapCopy(ctx, slide.body, body, maxWidth) : [];
    const headingLineH = heading.px * 1.1;
    const bodyLineH = body.px * 1.42;
    const gap = 30 * scale * shrink;
    const kickerPx = 28 * scale * shrink;
    const kickerH = role === "hook" ? 0 : kickerPx + 30 * scale * shrink;
    const siteH = role === "cta" ? (36 + 76) * scale : 0;
    const blockH =
      kickerH +
      headingLines.length * headingLineH +
      (bodyLines.length ? gap + bodyLines.length * bodyLineH : 0) +
      siteH;

    const fitted = { heading, body, headingLines, bodyLines, headingLineH, bodyLineH, gap, kickerPx, kickerH, siteH, blockH };
    if (blockH <= bandH || shrink <= MIN_COPY_SCALE || attempt >= 4) return fitted;
    shrink = Math.max(MIN_COPY_SCALE, shrink * Math.max(0.72, bandH / blockH));
  }
}

/**
 * The channel signature that closes every slide. Nothing on a slide otherwise
 * says whose it is, and these decks get reposted stripped of their caption —
 * the marks and the names are the only thing that survives that.
 */
let slideSignature: CreatorSignature = { name: "", handle: "" };

/**
 * Whose it is comes from the creator profile, not from this file. It was two
 * constants naming one person, so every deck anyone rendered was signed with
 * his name and handle. Empty is the default and empty draws nothing: an
 * unsigned slide is right for someone who has not said whose it is, and it is
 * the one answer that cannot be wrong.
 *
 * A module-level pair rather than a parameter because `paintSlide` is called
 * from the editor, the preview, the download path and the tests, and threading
 * a signature through all four to reach one `fillText` would put the profile
 * into the signature of every one of them.
 */
export function setSlideSignature(signature: Partial<CreatorSignature>) {
  slideSignature = {
    name: (signature.name ?? "").trim(),
    handle: (signature.handle ?? "").trim()
  };
}

/** Whose name closes a slide right now. */
export function slideSignatureOf(): CreatorSignature {
  return slideSignature;
}

/**
 * A straight-edged shape. `arcTo` with a zero radius is a straight line, which
 * is the whole of what the marks below need — a `lineTo` would mean widening
 * `SlideContext`, and every context this paints into has to implement it.
 */
function fillPolygon(ctx: SlideContext, points: Array<[number, number]>) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    ctx.arcTo(points[i][0], points[i][1], next[0], next[1], 0);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * The marks are drawn rather than fetched. An external logo taints the canvas
 * and `toBlob` then returns null for the whole slide, so the one piece of brand
 * furniture on every slide is built out of the same paths as everything else.
 */
function drawYouTubeMark(ctx: SlideContext, x: number, y: number, markW: number, alpha: number) {
  const markH = markW * 0.7;
  ctx.save();
  ctx.fillStyle = `rgba(255,0,0,${alpha.toFixed(2)})`;
  roundedRectPath(ctx, x, y, markW, markH, markH * 0.28);
  ctx.fill();
  const left = x + markW * 0.4;
  const tip = x + markW * 0.63;
  ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
  fillPolygon(ctx, [
    [left, y + markH * 0.3],
    [tip, y + markH / 2],
    [left, y + markH * 0.7]
  ]);
  ctx.restore();
}

/**
 * The X mark, as the X mark actually is.
 *
 * Not a typed letter X and not two crossing bars — both were tried and both
 * read as a placeholder. These are the logo's own outlines, on its 24-unit
 * grid: the wings and the counter in one shape, the main diagonal in another.
 * Filled as two polygons rather than one path with a hole, because a hole
 * needs a fill rule and `SlideContext.fill` does not take one — and their union
 * is the mark either way.
 */
const X_MARK_GRID = 24;
const X_MARK_SHAPES: Array<Array<[number, number]>> = [
  [
    [18.244, 2.25], [21.552, 2.25], [14.325, 10.51], [22.827, 21.75],
    [16.17, 21.75], [10.956, 14.933], [4.99, 21.75], [1.68, 21.75],
    [9.41, 12.915], [1.254, 2.25], [8.08, 2.25], [12.793, 8.481]
  ],
  [
    [17.083, 19.77], [18.916, 19.77], [7.084, 4.126], [5.117, 4.126]
  ]
];

function drawXMark(ctx: SlideContext, x: number, y: number, size: number, ink: string) {
  const unit = size / X_MARK_GRID;
  ctx.save();
  ctx.fillStyle = ink;
  for (const shape of X_MARK_SHAPES) {
    fillPolygon(ctx, shape.map(([px, py]): [number, number] => [x + px * unit, y + py * unit]));
  }
  ctx.restore();
}

function drawSignature(ctx: SlideContext, scale: number, centerY: number, left: number, maxRight: number) {
  const { name, handle } = slideSignature;
  if (!name && !handle) return;

  const fontPx = 26 * scale;
  ctx.font = `700 ${fontPx}px ${SLIDE_FONT_STACK}`;
  ctx.textAlign = "left";
  const ytW = 40 * scale;
  const xW = 28 * scale;
  const markGap = 12 * scale;
  const itemGap = 32 * scale;
  const part = (text: string, markW: number) => (text ? markW + markGap + ctx.measureText(text).width : 0);
  const both = part(name, ytW) + part(handle, xW) + (name && handle ? itemGap : 0);
  const room = maxRight - left;
  const showName = Boolean(name) && (both <= room || !handle) && part(name, ytW) <= room;
  const showHandle = Boolean(handle) && (showName ? both <= room : part(handle, xW) <= room);

  const ink = COLATERAL_THEME.counter;
  const baseline = centerY + fontPx * 0.36;
  let cursor = left;
  if (showName) {
    drawYouTubeMark(ctx, cursor, centerY - ytW * 0.35, ytW, 0.92);
    cursor += ytW + markGap;
    ctx.fillStyle = ink;
    ctx.fillText(name, cursor, baseline);
    cursor += ctx.measureText(name).width + itemGap;
  }
  if (showHandle) {
    drawXMark(ctx, cursor, centerY - xW / 2, xW, ink);
    cursor += xW + markGap;
    ctx.fillStyle = ink;
    ctx.fillText(handle, cursor, baseline);
  }
}

const BEAMY_TONES: Record<string, string> = {
  body: "#0078d4",
  hi: "#5eb2f2",
  shadow: "#005a9e",
  ink: "#102a43",
  hat: "#ffffff",
  hatsh: "#a8c4de"
};

const BEAMY_SPRITE: Array<[string, number, number, number, number]> = [
  ["hi", 8, 18, 2, 1], ["body", 6, 19, 3, 2], ["hi", 6, 19, 3, 1], ["body", 22, 18, 2, 1],
  ["body", 23, 19, 3, 2], ["shadow", 23, 20, 3, 1], ["body", 6, 12, 20, 3], ["body", 10, 15, 12, 9],
  ["body", 6, 24, 20, 2], ["hi", 6, 12, 20, 1], ["hi", 10, 15, 1, 9], ["hi", 6, 24, 20, 1],
  ["shadow", 21, 15, 1, 9], ["shadow", 25, 12, 1, 3], ["shadow", 6, 25, 20, 1], ["shadow", 11, 26, 3, 1],
  ["shadow", 10, 27, 3, 1], ["shadow", 18, 26, 3, 1], ["shadow", 19, 27, 3, 1], ["hat", 13, 6, 6, 1],
  ["hat", 12, 7, 8, 1], ["hat", 11, 8, 10, 1], ["hat", 11, 9, 10, 1], ["hat", 11, 10, 10, 1],
  ["hatsh", 18, 6, 1, 1], ["hatsh", 19, 7, 1, 1], ["hatsh", 20, 8, 1, 3], ["hat", 9, 11, 14, 1],
  ["hatsh", 9, 12, 14, 1], ["ink", 13, 17, 2, 2], ["ink", 17, 17, 2, 2], ["ink", 13, 20, 1, 1],
  ["ink", 18, 20, 1, 1], ["ink", 14, 21, 4, 1]
];

export function drawBeamBuddy(ctx: SlideContext, x: number, y: number, size: number) {
  const unit = size / 22;
  ctx.save();
  for (const [tone, px, py, pw, ph] of BEAMY_SPRITE) {
    ctx.fillStyle = BEAMY_TONES[tone];
    ctx.fillRect(x + (px - 5) * unit, y + (py - 5.5) * unit, pw * unit, ph * unit);
  }
  ctx.restore();
}

function drawHeader(ctx: SlideContext, index: number, total: number, w: number, scale: number, onPicture: boolean) {
  const margin = 72 * scale;
  const top = 52 * scale;
  const rowH = 64 * scale;
  const mark = 44 * scale;
  const pad = 18 * scale;
  ctx.textAlign = "left";

  ctx.font = `800 ${30 * scale}px ${SLIDE_FONT_STACK}`;
  const wordmarkW = ctx.measureText("CoLateral").width;
  ctx.font = `700 ${24 * scale}px ${SLIDE_FONT_STACK}`;
  const siteW = ctx.measureText(COLATERAL_SITE).width;
  const divider = 18 * scale;
  const leftW = mark + 14 * scale + wordmarkW + divider * 2 + 2 * scale + siteW;
  if (onPicture) {
    ctx.fillStyle = COLATERAL_THEME.chip;
    roundedRectPath(ctx, margin - pad, top, leftW + pad * 2, rowH, rowH / 2);
    ctx.fill();
  }
  drawBeamBuddy(ctx, margin, top + (rowH - mark) / 2, mark);
  ctx.font = `800 ${30 * scale}px ${SLIDE_FONT_STACK}`;
  ctx.fillStyle = COLATERAL_THEME.heading;
  const wordmarkX = margin + mark + 14 * scale;
  ctx.fillText("CoLateral", wordmarkX, top + rowH / 2 + 11 * scale);
  const dividerX = wordmarkX + wordmarkW + divider;
  ctx.fillStyle = COLATERAL_THEME.track;
  ctx.fillRect(dividerX, top + rowH * 0.28, 2 * scale, rowH * 0.44);
  ctx.font = `700 ${24 * scale}px ${SLIDE_FONT_STACK}`;
  ctx.fillStyle = COLATERAL_THEME.accent;
  ctx.fillText(COLATERAL_SITE, dividerX + 2 * scale + divider, top + rowH / 2 + 9 * scale);

  const counter = `${index + 1}/${total}`;
  ctx.font = `700 ${26 * scale}px ${SLIDE_FONT_STACK}`;
  const counterW = ctx.measureText(counter).width;
  const segGap = 6 * scale;
  const segW = Math.max(10 * scale, Math.min(34 * scale, (220 * scale) / Math.max(1, total)));
  const barW = total * segW + (total - 1) * segGap;
  const rightW = barW + 18 * scale + counterW;
  const rightX = w - margin - rightW;
  if (onPicture) {
    ctx.fillStyle = COLATERAL_THEME.chip;
    roundedRectPath(ctx, rightX - pad, top, rightW + pad * 2, rowH, rowH / 2);
    ctx.fill();
  }
  const segH = 7 * scale;
  const segY = top + (rowH - segH) / 2;
  for (let i = 0; i < total; i += 1) {
    ctx.fillStyle = i <= index ? COLATERAL_THEME.accent : COLATERAL_THEME.track;
    roundedRectPath(ctx, rightX + i * (segW + segGap), segY, segW, segH, segH / 2);
    ctx.fill();
  }
  ctx.fillStyle = COLATERAL_THEME.counter;
  ctx.fillText(counter, rightX + barW + 18 * scale, top + rowH / 2 + 9 * scale);
}

function drawArrow(ctx: SlideContext, x: number, y: number, size: number, ink: string) {
  const t = size * 0.16;
  ctx.fillStyle = ink;
  ctx.fillRect(x, y - t / 2, size * 0.8, t);
  fillPolygon(ctx, [
    [x + size * 0.5, y - size * 0.4],
    [x + size, y],
    [x + size * 0.5, y + size * 0.4],
    [x + size * 0.5, y + size * 0.18],
    [x + size * 0.72, y],
    [x + size * 0.5, y - size * 0.18]
  ]);
}

function drawPill(ctx: SlideContext, label: string, right: number, centerY: number, scale: number, filled: boolean): number {
  const fontPx = 28 * scale;
  ctx.font = `800 ${fontPx}px ${SLIDE_FONT_STACK}`;
  ctx.textAlign = "left";
  const arrow = 26 * scale;
  const padX = 28 * scale;
  const pillH = 64 * scale;
  const textW = ctx.measureText(label).width;
  const pillW = padX * 2 + textW + 14 * scale + arrow;
  const left = right - pillW;
  ctx.fillStyle = filled ? COLATERAL_THEME.accentDeep : COLATERAL_THEME.chip;
  roundedRectPath(ctx, left, centerY - pillH / 2, pillW, pillH, pillH / 2);
  ctx.fill();
  const ink = filled ? "#ffffff" : COLATERAL_THEME.accent;
  ctx.fillStyle = ink;
  ctx.fillText(label, left + padX, centerY + fontPx * 0.36);
  drawArrow(ctx, left + padX + textW + 14 * scale, centerY, arrow, ink);
  return pillW;
}

function drawSiteButton(ctx: SlideContext, left: number, top: number, scale: number) {
  const pillH = 76 * scale;
  const fontPx = 32 * scale;
  const mark = 40 * scale;
  const padX = 24 * scale;
  ctx.font = `800 ${fontPx}px ${SLIDE_FONT_STACK}`;
  ctx.textAlign = "left";
  const label = `Try it at ${COLATERAL_SITE}`;
  const textW = ctx.measureText(label).width;
  const pillW = padX * 2 + mark + 16 * scale + textW;
  ctx.fillStyle = COLATERAL_THEME.siteFill;
  roundedRectPath(ctx, left, top, pillW, pillH, pillH / 2);
  ctx.fill();
  drawBeamBuddy(ctx, left + padX, top + (pillH - mark) / 2, mark);
  ctx.fillStyle = COLATERAL_THEME.heading;
  ctx.fillText(label, left + padX + mark + 16 * scale, top + pillH / 2 + fontPx * 0.36);
}

function drawBaseText(
  ctx: SlideContext,
  slide: CarouselSlide,
  index: number,
  total: number,
  w: number,
  h: number,
  images: Map<string, SlideImage | null> | undefined
) {
  const scale = w / 1080;
  const margin = 88 * scale;
  const onPicture = Boolean(slide.textBand) || slideImageLayers(slide).length > 0;
  const role = slideRole(index, total);

  drawHeader(ctx, index, total, w, scale, onPicture);

  const footerY = h - 76 * scale;
  const bandTop = slide.textBand ? slide.textBand.top * h : 160 * scale;
  const bandBottom = slide.textBand ? Math.min(slide.textBand.bottom * h, footerY - 44 * scale) : footerY - 64 * scale;
  const maxWidth = w - margin * 2;
  const fit = fitCopy(ctx, slide, role, scale, maxWidth, bandBottom - bandTop);

  const room = bandBottom - bandTop - fit.blockH;
  const mascot = role === "cta" && !slide.textBand && room > 300 * scale ? 170 * scale : 0;
  let y = bandTop + Math.max(0, room - (mascot ? mascot + 40 * scale : 0)) / 2;
  if (mascot) {
    drawBeamBuddy(ctx, margin - 6 * scale, y, mascot);
    y += mascot + 40 * scale;
  }

  if (fit.kickerH) {
    const label = role === "cta" ? "WHAT'S NEXT" : String(index + 1).padStart(2, "0");
    ctx.font = `800 ${fit.kickerPx}px ${SLIDE_FONT_STACK}`;
    ctx.textAlign = "left";
    ctx.fillStyle = COLATERAL_THEME.accent;
    const baseline = y + fit.kickerPx * 0.86;
    ctx.fillText(label, margin, baseline);
    const labelW = ctx.measureText(label).width;
    ctx.fillRect(margin + labelW + 16 * scale, baseline - fit.kickerPx * 0.36, 64 * scale, 4 * scale);
    y += fit.kickerH;
  }

  const headingColors = { regular: slide.headingColor ?? COLATERAL_THEME.heading, strong: COLATERAL_THEME.accent };
  for (const line of fit.headingLines) {
    drawCopyLine(ctx, line, margin, y + fit.heading.px * 0.86, fit.heading, headingColors, images);
    y += fit.headingLineH;
  }
  if (fit.bodyLines.length) {
    y += fit.gap;
    const bodyColors = { regular: slide.bodyColor ?? COLATERAL_THEME.body, strong: COLATERAL_THEME.strong };
    for (const line of fit.bodyLines) {
      drawCopyLine(ctx, line, margin, y + fit.body.px * 1.02, fit.body, bodyColors, images);
      y += fit.bodyLineH;
    }
  }
  if (fit.siteH) drawSiteButton(ctx, margin, y + 36 * scale, scale);

  const right = w - 72 * scale;
  const pill =
    role === "cta"
      ? drawPill(ctx, slideSignature.handle ? `Follow ${slideSignature.handle}` : "Follow for more", right, footerY, scale, true)
      : drawPill(ctx, role === "hook" ? "Swipe" : "Next", right, footerY, scale, role === "hook");
  drawSignature(ctx, scale, footerY, 72 * scale, right - pill - 28 * scale);
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
  /**
   * Pixel width to render at; the height follows the aspect ratio. Defaults to
   * the ratio's export resolution.
   *
   * Every measurement in here is a fraction of the slide, so a small render is
   * the same picture, not a different layout. A wall of thumbnails must ask for
   * thumbnail pixels: forty 1080×1350 canvases is a quarter of a gigabyte of
   * backing store, and past the browser's canvas budget the extra ones come
   * back blank.
   */
  width?: number;
};

/** The pixel size a slide renders at, honoring an explicit width. */
export function slidePixelSize(ratio: CarouselAspectRatio, width?: number) {
  const spec = aspectSpec(ratio);
  const w = width ? Math.max(1, Math.round(width)) : spec.width;
  return { width: w, height: Math.max(1, Math.round((w * spec.height) / spec.width)) };
}

export function slideImageLayers(slide: CarouselSlide): Extract<SlideLayer, { type: "image" }>[] {
  return (slide.layers ?? []).filter((l): l is Extract<SlideLayer, { type: "image" }> => l.type === "image");
}

/**
 * Every emoji a slide will draw as a picture. The counter is not in here on
 * purpose — it is a number this code writes, not copy anyone typed.
 */
export function slideEmoji(slide: CarouselSlide): string[] {
  const copy = [slide.heading ?? "", slide.body ?? ""];
  for (const layer of slide.layers ?? []) {
    if (layer.type === "text") copy.push(layer.text ?? "");
  }
  return emojiIn(copy.join("\n"));
}

/** Every emoji in a whole deck, deduplicated — one download covers every slide. */
export function carouselEmoji(slides: CarouselSlide[]): string[] {
  return emojiIn(slides.flatMap(slideEmoji).join("\n"));
}

/**
 * Paints one slide into an already-sized 2D context. Every measurement is a
 * fraction of the slide, so this is the whole layout — the browser export, the
 * editor preview and the server's PNG all come through here, with only the
 * canvas and the picture decoder differing.
 *
 * `images` is keyed by layer `src`, and by `emojiImageKey` for the Apple emoji
 * pictures the copy is set with; a missing or failed picture is simply not
 * drawn, which is what keeps a deck exportable when one photo has gone.
 */
export function paintSlide(
  ctx: SlideContext,
  input: {
    slide: CarouselSlide;
    index: number;
    total: number;
    width: number;
    height: number;
    images?: Map<string, SlideImage | null>;
  },
  options: RenderSlideOptions = {}
) {
  const { slide, index, total, width, height } = input;

  // Background: solid/gradient override or the brand default.
  if (!options.skipBackground) {
    if (slide.background) {
      ctx.fillStyle = slide.background;
      ctx.fillRect(0, 0, width, height);
    } else {
      paintDefaultBackground(ctx, width, height);
    }
  }

  // Image layers render under the base copy; text layers over it.
  if (!options.skipImageLayers) {
    for (const layer of slideImageLayers(slide)) {
      const img = input.images?.get(layer.src);
      if (img) drawImageLayer(ctx, layer, img, width, height, slide.textBand?.top ?? 1);
    }
  }

  // The veil goes on with the chrome, not with the pictures: in the editor the
  // image layers are live DOM under this canvas, so painting it here is what
  // keeps the stacked preview in the same z-order as the export.
  if (!options.skipBaseText && slide.scrim) paintScrim(ctx, slide.scrim, width, height);

  if (!options.skipBaseText && !slide.hideBaseText) drawBaseText(ctx, slide, index, total, width, height, input.images);

  if (!options.skipTextLayers) {
    for (const layer of slide.layers ?? []) {
      if (layer.type === "text") drawTextLayer(ctx, layer, width, height, input.images);
    }
  }
}

let slideFonts: Promise<void> | null = null;

function loadSlideFonts(): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return Promise.resolve();
  slideFonts ??= Promise.all(SLIDE_FONT_WEIGHTS.map((weight) => fonts.load(`${weight} 40px Inter`)))
    .then(() => undefined)
    .catch(() => undefined);
  return slideFonts;
}

/**
 * Renders one slide into a fresh canvas at the given aspect ratio's full
 * resolution, or at `options.width`. Async because image layers must decode
 * first.
 */
export async function renderSlideCanvas(
  slide: CarouselSlide,
  index: number,
  total: number,
  ratio: CarouselAspectRatio,
  options: RenderSlideOptions = {}
): Promise<HTMLCanvasElement> {
  const { width, height } = slidePixelSize(ratio, options.width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const images = new Map<string, SlideImage | null>();
  const loads: Promise<unknown>[] = [];
  if (!options.skipImageLayers) {
    loads.push(
      ...slideImageLayers(slide).map(async (layer) => {
        images.set(layer.src, await loadImage(layer.src).catch(() => null));
      })
    );
  }
  // Emoji load whatever else is skipped: the editor stacks the picture layers
  // as live DOM and paints only the copy here, and the copy is where they are.
  loads.push(
    ...slideEmoji(slide).map(async (glyph) => {
      images.set(emojiImageKey(glyph), await loadEmojiImage(glyph));
    })
  );
  loads.push(loadSlideFonts());
  await Promise.all(loads);

  paintSlide(ctx, { slide, index, total, width, height, images }, options);
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
