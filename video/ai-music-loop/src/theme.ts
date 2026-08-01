export const theme = {
  bg: "#0b0c12",
  surface: "#161822",
  accent: "#bd93f9",
  pink: "#ff79c6",
  cyan: "#8be9fd",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  text: "#f8f8f2",
  muted: "#6272a4",
  dim: "#2a2d3e",
} as const;

export const fontFamily =
  '"Segoe UI", "Inter", system-ui, -apple-system, sans-serif';

export const LOOP_SECONDS = 30;
export const FPS = 30;
export const TOTAL_FRAMES = LOOP_SECONDS * FPS;
