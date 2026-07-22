// Brand accents mirrored from the CoLateral dashboard (Lime, Violet, Ocean,
// Sunset, Rose, Mono). Keeps generated segments on-brand with the app.
import { z } from "zod";

export const themeSchema = z.enum([
  "dracula",
  "lime",
  "violet",
  "ocean",
  "sunset",
  "rose",
  "mono",
]);

export type ThemeName = z.infer<typeof themeSchema>;

export const THEMES: Record<
  ThemeName,
  { accent: string; accentSoft: string; bg: string; text: string; sub: string }
> = {
  // Nic's signature theme — matches Capital Command's "Dracula" preset.
  // bg #282a36 / surface #343746 / accent #bd93f9 from src/lib/themes.ts,
  // with authentic Dracula foreground (#f8f8f2) and comment (#6272a4).
  dracula: { accent: "#bd93f9", accentSoft: "#6272a4", bg: "#282a36", text: "#f8f8f2", sub: "#6272a4" },
  lime: { accent: "#a3e635", accentSoft: "#65a30d", bg: "#0a0f0a", text: "#f7fee7", sub: "#a3b18a" },
  violet: { accent: "#a78bfa", accentSoft: "#7c3aed", bg: "#0d0a14", text: "#f5f3ff", sub: "#a5a1c4" },
  ocean: { accent: "#38bdf8", accentSoft: "#0284c7", bg: "#07121a", text: "#f0f9ff", sub: "#8ba9bf" },
  sunset: { accent: "#fb923c", accentSoft: "#ea580c", bg: "#160c07", text: "#fff7ed", sub: "#c4a58b" },
  rose: { accent: "#fb7185", accentSoft: "#e11d48", bg: "#160910", text: "#fff1f2", sub: "#c48b9b" },
  mono: { accent: "#e5e7eb", accentSoft: "#9ca3af", bg: "#0a0a0a", text: "#fafafa", sub: "#9ca3af" },
};

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
