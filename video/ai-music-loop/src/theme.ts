export const theme = {
  bgDeep: "#0a0018",
  bgMid: "#1a0538",
  purple: "#7b2ff7",
  violet: "#a855f7",
  magenta: "#e040fb",
  pink: "#ff2d95",
  blue: "#4f46e5",
  cyan: "#22d3ee",
  white: "#f8fafc",
  soft: "#c4b5fd",
  dim: "#4c1d95",
} as const;

export const fontFamily =
  '"Segoe UI Black", "Impact", "Arial Black", "Segoe UI", system-ui, sans-serif';

export const LOOP_SECONDS = 30;
export const FPS = 30;
export const TOTAL_FRAMES = LOOP_SECONDS * FPS;
export const BPM = 124;
export const BEAT_FRAMES = (60 / BPM) * FPS;
