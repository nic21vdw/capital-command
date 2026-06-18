export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

/** Maximum number of movable image layers a user can place on the canvas. */
export const MAX_IMAGES = 5;

export type BackgroundStyleId =
  | "gradient"
  | "tech-glow"
  | "blueprint"
  | "speed-lines"
  | "blurred-frame"
  | "color-block"
  | "spotlight"
  | "split-screen"
  | "minimal-dark"
  | "podcast"
  // AI-creator backgrounds, modelled on what performs in the AI content niche.
  | "neural-net"
  | "circuit"
  | "data-stream"
  | "particles"
  | "holographic"
  | "aurora"
  | "cinematic"
  | "mega-pop";

export type Palette = {
  name: string;
  /** Primary background color. */
  bg1: string;
  /** Secondary background color (gradient stop / pattern). */
  bg2: string;
  /** Accent used for highlights, bars, and glow. */
  accent: string;
  /** Main text color. */
  text: string;
};

export type TextEmphasis = "outline" | "highlight-bar" | "boxed" | "clean";
export type TextPosition = "left" | "bottom-left" | "center";
export type TextSize = "small" | "medium" | "large";
export type Intensity = "subtle" | "balanced" | "bold";

/**
 * Free-placement transform for a layer. `x`/`y` are the layer center as a
 * fraction of the canvas (0..1), `scale` is a multiplier on the layer's
 * natural size (its width), and `rotation` is in degrees.
 *
 * `scaleY` is an optional independent height multiplier. When omitted (or equal
 * to `scale`), the layer scales proportionally; when set, width and height scale
 * independently. `opacity` is 0..1 and defaults to 1.
 */
export type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  scaleY?: number;
  opacity?: number;
};

/** Effective height multiplier — proportional (equal to `scale`) by default. */
export function effectiveScaleY(t: Transform): number {
  return t.scaleY ?? t.scale;
}

/** Effective opacity — fully opaque by default. */
export function effectiveOpacity(t: Transform): number {
  return t.opacity ?? 1;
}

/**
 * Per-image cut-out treatment: the MrBeast/Dan Martell-style subject look.
 * `cutout` switches a layer from the plain right-panel composite to a
 * free-floating subject with stroke / glow / shadow / backlight and color
 * grading. Pairs with the in-browser background removal.
 */
export type ImageTreatment = {
  /** Free-floating cut-out (vs. the plain right-side panel in auto layout). */
  cutout: boolean;
  flip: boolean;
  /** Outline thickness in px (0 = none). */
  stroke: number;
  strokeColor: string;
  /** Outer glow strength, 0..1. */
  glow: number;
  shadow: boolean;
  /** Radial accent pop behind the subject. */
  backlight: boolean;
  /** CSS filter multipliers applied to this image only. */
  saturate: number;
  contrast: number;
  brightness: number;
};

export const DEFAULT_TREATMENT: ImageTreatment = {
  cutout: false,
  flip: false,
  stroke: 0,
  strokeColor: "#ffffff",
  glow: 0,
  shadow: true,
  backlight: false,
  saturate: 1,
  contrast: 1,
  brightness: 1
};

/** A movable image dropped onto the canvas. */
export type ImageLayer = {
  id: string;
  name: string;
  image: HTMLImageElement;
  transform: Transform;
  treatment: ImageTreatment;
  /** When locked the layer can't be dragged, resized, rotated, or deleted. */
  locked?: boolean;
  /** When true (default) width/height scale proportionally together. */
  lockAspect?: boolean;
};

export type StickerType = "circle" | "arrow" | "emoji" | "badge";

export type Sticker = {
  id: string;
  type: StickerType;
  /** Center position, normalized 0..1 across the canvas. */
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
  color: string;
  /** Emoji glyph or badge label, depending on type. */
  text: string;
};

export type ThumbnailOptions = {
  /** Movable image layers (up to MAX_IMAGES). The first one also feeds
   *  background styles that consume an image (blurred frame, split screen)
   *  and is the subject in automatic layout. */
  images: ImageLayer[];
  text: string;
  /** When manual layout is on, the text is positioned with this transform. */
  textTransform: Transform;
  /** When true, images and text are drawn at their transforms instead of the
   *  automatic background-aware layout. */
  manualLayout: boolean;
  style: BackgroundStyleId;
  paletteIndex: number;
  intensity: Intensity;
  emphasis: TextEmphasis;
  position: TextPosition;
  size: TextSize;
  uppercase: boolean;

  // Text styling
  /** Font catalog id (see lib/thumbnails/fonts). */
  fontId: string;
  /** Custom text color as a hex string, or "auto" to follow the palette. */
  textColor: string;
  /** Color for words wrapped in *asterisks*. */
  highlightColor: string;

  // Call-out graphics
  stickers: Sticker[];
};

export const INTENSITY_FACTOR: Record<Intensity, number> = {
  subtle: 0.55,
  balanced: 1,
  bold: 1.45
};

/** Sensible starting transform for the text block in manual layout. */
export const DEFAULT_TEXT_TRANSFORM: Transform = { x: 0.32, y: 0.5, scale: 1, rotation: 0 };

/** Spread a freshly added image around the right side of the canvas. */
export function defaultImageTransform(index: number): Transform {
  const spots: Transform[] = [
    { x: 0.74, y: 0.5, scale: 1, rotation: 0 },
    { x: 0.6, y: 0.34, scale: 0.7, rotation: -6 },
    { x: 0.84, y: 0.68, scale: 0.7, rotation: 6 },
    { x: 0.55, y: 0.72, scale: 0.6, rotation: -4 },
    { x: 0.9, y: 0.3, scale: 0.6, rotation: 8 }
  ];
  return { ...spots[index % spots.length] };
}
