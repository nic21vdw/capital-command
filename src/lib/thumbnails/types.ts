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
};

export const INTENSITY_FACTOR: Record<Intensity, number> = {
  subtle: 0.55,
  balanced: 1,
  bold: 1.45
};
