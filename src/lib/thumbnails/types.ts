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
  | "podcast";

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
 * natural size, and `rotation` is in degrees.
 */
export type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

/** A movable image dropped onto the canvas. */
export type ImageLayer = {
  id: string;
  name: string;
  image: HTMLImageElement;
  transform: Transform;
};

export type ThumbnailOptions = {
  /** Movable image layers (up to MAX_IMAGES). The first one also feeds
   *  background styles that consume an image (blurred frame, split screen). */
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
