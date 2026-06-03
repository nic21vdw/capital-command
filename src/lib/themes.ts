import type { AccentTheme } from "@/types/domain";

export interface AccentThemeDef {
  id: AccentTheme;
  label: string;
  description: string;
  swatch: string;
  swatchStrong: string;
}

export const accentThemes: AccentThemeDef[] = [
  { id: "lime", label: "Lime", description: "Calm signal green", swatch: "#d5ff7f", swatchStrong: "#e2ffab" },
  { id: "stripe", label: "Violet", description: "Stripe-inspired purple", swatch: "#9b87ff", swatchStrong: "#b9aaff" },
  { id: "ocean", label: "Ocean", description: "Cool teal", swatch: "#4fd6e2", swatchStrong: "#7ee9f2" },
  { id: "sunset", label: "Sunset", description: "Warm amber", swatch: "#ffa463", swatchStrong: "#ffc499" },
  { id: "rose", label: "Rose", description: "Vivid pink", swatch: "#ff6f9f", swatchStrong: "#ff9bbd" },
  { id: "mono", label: "Mono", description: "Minimal monochrome", swatch: "#e6edf6", swatchStrong: "#ffffff" }
];

export const DEFAULT_ACCENT: AccentTheme = "lime";

export function isAccentTheme(value: unknown): value is AccentTheme {
  return accentThemes.some((theme) => theme.id === value);
}
