import type { ThemePreset } from "@/types/domain";

export interface ThemePresetDef {
  id: ThemePreset;
  label: string;
  description: string;
  mode: "dark" | "light";
  /** Preview swatches for the theme picker. */
  background: string;
  surface: string;
  accent: string;
}

export const themePresets: ThemePresetDef[] = [
  {
    id: "slate",
    label: "Slate",
    description: "Neutral dark, cool blue accent",
    mode: "dark",
    background: "#0b0d12",
    surface: "#14181f",
    accent: "#5b8def"
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy, electric blue",
    mode: "dark",
    background: "#05070d",
    surface: "#0c1119",
    accent: "#4f7dff"
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Monochrome charcoal",
    mode: "dark",
    background: "#0d0d0f",
    surface: "#18181b",
    accent: "#e4e4e7"
  },
  {
    id: "forest",
    label: "Forest",
    description: "Dark with a green signal",
    mode: "dark",
    background: "#08110d",
    surface: "#0f1c16",
    accent: "#2fd08a"
  },
  {
    id: "dracula",
    label: "Dracula",
    description: "Dark with a vibrant purple accent",
    mode: "dark",
    background: "#282a36",
    surface: "#343746",
    accent: "#bd93f9"
  },
  {
    id: "paper",
    label: "Paper",
    description: "Warm light, easy on the eyes",
    mode: "light",
    background: "#f5f4ef",
    surface: "#ffffff",
    accent: "#2f6df0"
  },
  {
    id: "arctic",
    label: "Arctic",
    description: "Cool light, crisp blue",
    mode: "light",
    background: "#eef1f6",
    surface: "#ffffff",
    accent: "#0ea5e9"
  }
];

export const DEFAULT_THEME: ThemePreset = "slate";

export const themePresetIds = themePresets.map((theme) => theme.id);

export function isThemePreset(value: unknown): value is ThemePreset {
  return themePresets.some((theme) => theme.id === value);
}
