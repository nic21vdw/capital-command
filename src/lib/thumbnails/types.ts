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

/** Display font families available for the overlay text. */
export type FontFamilyId = "impact" | "arial-black" | "condensed" | "system" | "serif";

export const FONT_STACKS: Record<FontFamilyId, string> = {
  impact: 'Impact, "Anton", "Haettenschweiler", "Arial Narrow Bold", sans-serif',
  "arial-black": '"Arial Black", "Segoe UI", system-ui, sans-serif',
  condensed: '"Roboto Condensed", "Oswald", "Arial Narrow", sans-serif',
  system: 'system-ui, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif'
};

export const FONT_LABELS: Record<FontFamilyId, string> = {
  impact: "Impact (Beast)",
  "arial-black": "Arial Black",
  condensed: "Condensed",
  system: "Clean sans",
  serif: "Editorial serif"
};

/**
 * How the uploaded image is placed.
 * - `panel`: original behaviour — cover-fit into the right ~45% panel.
 * - `cutout`: free-floating subject with stroke / glow / shadow, the
 *   MrBeast-style look (pairs with the Remove Background action).
 */
export type SubjectMode = "panel" | "cutout";

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

  // Text styling
  fontFamily: FontFamilyId;
  /** Color for words wrapped in *asterisks*. */
  highlightColor: string;
  /** Override for the main text color; empty string uses the palette default. */
  textColor: string;
  /** Whole-block tilt in degrees. */
  textRotation: number;

  // Subject treatment
  subjectMode: SubjectMode;
  /** Subject height as a fraction of canvas height. */
  subjectScale: number;
  /** Center offset, -1..1 relative to half the canvas. */
  subjectX: number;
  subjectY: number;
  subjectFlip: boolean;
  /** Outline thickness in px (0 = none). */
  subjectStroke: number;
  subjectStrokeColor: string;
  /** Outer glow strength, 0..1. */
  subjectGlow: number;
  subjectShadow: boolean;
  /** Radial accent pop behind the subject. */
  subjectBacklight: boolean;
  /** CSS filter multipliers applied to the subject only. */
  saturate: number;
  contrast: number;
  brightness: number;

  // Call-out graphics
  stickers: Sticker[];
};

export const INTENSITY_FACTOR: Record<Intensity, number> = {
  subtle: 0.55,
  balanced: 1,
  bold: 1.45
};

/**
 * Defaults for every option beyond `image` and `text`, so the UI and variant
 * builder share one source of truth and stay backward compatible.
 */
export const DEFAULT_THUMBNAIL_OPTIONS: Omit<ThumbnailOptions, "image" | "text"> = {
  style: "gradient",
  paletteIndex: 0,
  intensity: "balanced",
  emphasis: "outline",
  position: "left",
  size: "medium",
  uppercase: true,
  fontFamily: "impact",
  highlightColor: "#ffd34d",
  textColor: "",
  textRotation: 0,
  subjectMode: "panel",
  subjectScale: 1,
  subjectX: 0,
  subjectY: 0,
  subjectFlip: false,
  subjectStroke: 0,
  subjectStrokeColor: "#ffffff",
  subjectGlow: 0,
  subjectShadow: true,
  subjectBacklight: false,
  saturate: 1,
  contrast: 1,
  brightness: 1,
  stickers: []
};
