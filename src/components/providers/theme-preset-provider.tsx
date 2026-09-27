"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ThemePreset } from "@/types/domain";
import { DEFAULT_THEME, isThemePreset, normalizeThemePreset } from "@/lib/themes";
import {
  DEFAULT_APPEARANCE,
  HOST_THEME_KEY,
  HOST_THEME_MESSAGE,
  HOST_THEME_PARAM,
  THEME_STORAGE_KEY,
  applyHostAppearance,
  carriesAppearance,
  hostBootScript,
  mergeHostAppearance,
  readHostAppearance,
  readStoredAppearance,
  storeAppearance,
  type HostAppearance,
  type HostAppearanceInput,
} from "@/lib/host-appearance";

export { HOST_THEME_MESSAGE, HOST_THEME_PARAM, HOST_SURFACE_PARAM, HOST_GLASS_LEVEL_PARAM, HOST_BACKDROP_PARAM, mergeHostAppearance } from "@/lib/host-appearance";
export type { HostAppearance, HostSurface } from "@/lib/host-appearance";

function applyAppearance(appearance: HostAppearance) {
  if (typeof document === "undefined") return;
  applyHostAppearance(document.documentElement, appearance);
}

function readHostAppearanceNow(): HostAppearance {
  try {
    return readHostAppearance(window.location.search, window.sessionStorage);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function readSessionAppearance(): HostAppearance {
  try {
    return readStoredAppearance(window.sessionStorage);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function storeSessionAppearance(appearance: HostAppearance) {
  try {
    storeAppearance(window.sessionStorage, appearance);
  } catch {
    return;
  }
}

interface ThemePresetContextValue {
  theme: ThemePreset;
  setTheme: (theme: ThemePreset) => void;
  /** True while CoLateral is choosing the theme for this frame. */
  hosted: boolean;
}

const ThemePresetContext = createContext<ThemePresetContextValue | null>(null);

function applyTheme(theme: ThemePreset) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

function readHostTheme(): ThemePreset | null {
  try {
    const param = new URLSearchParams(window.location.search).get(HOST_THEME_PARAM);
    if (isThemePreset(param)) {
      window.sessionStorage.setItem(HOST_THEME_KEY, param);
      return param;
    }
    const stored = window.sessionStorage.getItem(HOST_THEME_KEY);
    return isThemePreset(stored) ? stored : null;
  } catch {
    return null;
  }
}

function readOwnTheme(): ThemePreset {
  try {
    return normalizeThemePreset(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function ThemePresetProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreset>(DEFAULT_THEME);
  const [hosted, setHosted] = useState(false);

  useEffect(() => {
    const fromHost = readHostTheme();
    const next = fromHost ?? readOwnTheme();
    applyTheme(next);
    applyAppearance(readHostAppearanceNow());
    const timer = window.setTimeout(() => {
      setThemeState(next);
      setHosted(fromHost !== null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as ({ type?: unknown; theme?: unknown } & HostAppearanceInput) | null;
      if (!data || typeof data !== "object" || data.type !== HOST_THEME_MESSAGE) return;
      if (carriesAppearance(data)) {
        const appearance = mergeHostAppearance(readSessionAppearance(), data);
        storeSessionAppearance(appearance);
        applyAppearance(appearance);
      }
      if (!isThemePreset(data.theme)) return;
      try {
        window.sessionStorage.setItem(HOST_THEME_KEY, data.theme);
      } catch {
        /* a frame without storage still repaints */
      }
      applyTheme(data.theme);
      setThemeState(data.theme);
      setHosted(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const setTheme = useCallback((next: ThemePreset) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode: the theme still applies for this page */
    }
  }, []);

  return (
    <ThemePresetContext.Provider value={{ theme, setTheme, hosted }}>{children}</ThemePresetContext.Provider>
  );
}

export function useThemePreset() {
  const context = useContext(ThemePresetContext);
  if (!context) {
    throw new Error("useThemePreset must be used inside ThemePresetProvider");
  }
  return context;
}

/**
 * Inline, render-blocking script that applies the theme before paint to avoid a
 * flash. The order matches the provider: the host's `?theme=` first, then the
 * host theme remembered for this tab, then the theme picked in Settings.
 */
export function ThemePresetScript() {
  return <script dangerouslySetInnerHTML={{ __html: hostBootScript() }} />;
}
