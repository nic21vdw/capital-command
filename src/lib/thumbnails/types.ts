export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

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
 * Free-form placement applied on top of a layer's base position. Offsets are
 * expressed as a percentage of the canvas (so they stay correct regardless of
 * export size); rotation is in degrees; scale is a multiplier.
 */
export type Transform = {
  /** Horizontal nudge, as a percentage of canvas width (-100..100). */
  offsetX: number;
  /** Vertical nudge, as a percentage of canvas height (-100..100). */
  offsetY: number;
  /** Size multiplier (1 = unchanged). */
  scale: number;
  /** Rotation in degrees (-180..180). */
  rotation: number;
};

export const DEFAULT_TRANSFORM: Transform = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };

export function isDefaultTransform(t: Transform): boolean {
  return t.offsetX === 0 && t.offsetY === 0 && t.scale === 1 && t.rotation === 0;
}

export type ThumbnailOptions = {
  /** Uploaded subject/source image, if any. */
  image: HTMLImageElement | null;
  text: string;
  style: BackgroundStyleId;
  paletteIndex: number;
  intensity: Intensity;
  emphasis: TextEmphasis;
  position: TextPosition;
  size: TextSize;
  uppercase: boolean;
  /** Move / scale / rotate applied to the subject image. */
  imageTransform: Transform;
  /** Move / scale / rotate applied to the text block. */
  textTransform: Transform;
};

export const INTENSITY_FACTOR: Record<Intensity, number> = {
  subtle: 0.55,
  balanced: 1,
  bold: 1.45
};
