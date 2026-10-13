"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { useThemePreset } from "@/components/providers/theme-preset-provider";
import { themePresets } from "@/lib/themes";

/**
 * Sonner's `richColors` paints its own pastel panels, which on the dark UI read
 * as a pink slab. The toast takes its colours from the app's tokens instead -
 * the surface, border and text of the active theme, with the tone colour as an
 * edge and tint - so a toast looks like part of the screen in every preset.
 * `theme` follows the preset's mode for the parts Sonner still draws itself.
 */
const TONE = (token: string) => ({
  bg: `color-mix(in srgb, var(${token}) 14%, var(--surface))`,
  border: `color-mix(in srgb, var(${token}) 45%, var(--border-strong))`,
  text: "var(--foreground)"
});

const toasterStyle = {
  "--normal-bg": "var(--surface)",
  "--normal-border": "var(--border-strong)",
  "--normal-text": "var(--foreground)",
  "--success-bg": TONE("--success").bg,
  "--success-border": TONE("--success").border,
  "--success-text": TONE("--success").text,
  "--error-bg": TONE("--danger").bg,
  "--error-border": TONE("--danger").border,
  "--error-text": TONE("--danger").text,
  "--warning-bg": TONE("--warning").bg,
  "--warning-border": TONE("--warning").border,
  "--warning-text": TONE("--warning").text,
  "--info-bg": TONE("--info").bg,
  "--info-border": TONE("--info").border,
  "--info-text": TONE("--info").text
} as CSSProperties;

export function AppToaster() {
  const { theme } = useThemePreset();
  const mode = themePresets.find((preset) => preset.id === theme)?.mode ?? "dark";
  return (
    <Toaster
      richColors
      theme={mode}
      className="app-toaster"
      style={toasterStyle}
      position="bottom-right"
      visibleToasts={3}
      expand
      offset={{ bottom: "calc(var(--command-bar-h, 5rem) + 0.75rem)", right: "1rem" }}
      mobileOffset={{ bottom: "calc(var(--command-bar-h, 5rem) + 0.5rem)", left: "0.5rem", right: "0.5rem" }}
    />
  );
}
