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
    id: "dark",
    label: "CoLateral Dark",
    description: "CoLateral's own dark palette",
    mode: "dark",
    background: "#070c12",
    surface: "#111922",
    accent: "#4da6ff"
  },
  {
    id: "light",
    label: "Office Blue",
    description: "CoLateral's light appearance",
    mode: "light",
    background: "#f3f6fa",
    surface: "#f7f9fc",
    accent: "#0078d4"
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
    id: "catppuccin",
    label: "Catppuccin Mocha",
    description: "Soft pastel dark",
    mode: "dark",
    background: "#1e1e2e",
    surface: "#313244",
    accent: "#89b4fa"
  },
  {
    id: "nord",
    label: "Nord",
    description: "Cool arctic dark",
    mode: "dark",
    background: "#2e3440",
    surface: "#3b4252",
    accent: "#88c0d0"
  },
  {
    id: "tokyonight",
    label: "Tokyo Night",
    description: "Neon-lit night dark",
    mode: "dark",
    background: "#1a1b26",
    surface: "#24283b",
    accent: "#7aa2f7"
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    description: "Warm retro dark",
    mode: "dark",
    background: "#282828",
    surface: "#3c3836",
    accent: "#83a598"
  },
  {
    id: "everforest",
    label: "Everforest",
    description: "Muted forest green dark",
    mode: "dark",
    background: "#2d353b",
    surface: "#374247",
    accent: "#a7c080"
  },
  {
    id: "github",
    label: "GitHub Dark",
    description: "GitHub's dark editor palette",
    mode: "dark",
    background: "#0d1117",
    surface: "#161b22",
    accent: "#2f81f7"
  },
  {
    id: "ayu",
    label: "Ayu Mirage",
    description: "Balanced warm dark",
    mode: "dark",
    background: "#1f2430",
    surface: "#232834",
    accent: "#5ccfe6"
  },
  {
    id: "onedark",
    label: "One Dark",
    description: "Atom's classic dark",
    mode: "dark",
    background: "#282c34",
    surface: "#2c313a",
    accent: "#61afef"
  },
  {
    id: "monokai",
    label: "Monokai",
    description: "High-contrast classic dark",
    mode: "dark",
    background: "#272822",
    surface: "#3e3d32",
    accent: "#66d9ef"
  },
  {
    id: "rosepine",
    label: "Rosé Pine",
    description: "Muted rose dark",
    mode: "dark",
    background: "#191724",
    surface: "#26233a",
    accent: "#c4a7e7"
  },
  {
    id: "solarized",
    label: "Solarized Dark",
    description: "Low-contrast teal dark",
    mode: "dark",
    background: "#002b36",
    surface: "#0a3f4d",
    accent: "#268bd2"
  },
  {
    id: "linear",
    label: "Linear",
    description: "Sharp near-black dark",
    mode: "dark",
    background: "#08090a",
    surface: "#1c1c1f",
    accent: "#5e6ad2"
  },
  {
    id: "absolutely",
    label: "Absolutely",
    description: "Deep indigo dark",
    mode: "dark",
    background: "#0a0a0f",
    surface: "#161620",
    accent: "#8bc6fa"
  },
  {
    id: "codex",
    label: "Codex",
    description: "Cool blue-violet dark",
    mode: "dark",
    background: "#080810",
    surface: "#141420",
    accent: "#6c8cff"
  }
];

export const DEFAULT_THEME: ThemePreset = "dark";

export const themePresetIds = themePresets.map((theme) => theme.id);

export function isThemePreset(value: unknown): value is ThemePreset {
  return themePresets.some((theme) => theme.id === value);
}

export const LEGACY_THEME_IDS: Record<string, ThemePreset> = {
  colateral: "dark",
  "colateral-light": "light",
  slate: DEFAULT_THEME,
  midnight: DEFAULT_THEME,
  graphite: DEFAULT_THEME,
  forest: DEFAULT_THEME,
  paper: DEFAULT_THEME,
  arctic: DEFAULT_THEME
};

export function normalizeThemePreset(value: unknown): ThemePreset {
  if (isThemePreset(value)) return value;
  if (typeof value === "string" && value in LEGACY_THEME_IDS) {
    return LEGACY_THEME_IDS[value];
  }
  return DEFAULT_THEME;
}
