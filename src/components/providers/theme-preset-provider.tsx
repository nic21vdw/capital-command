"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ThemePreset } from "@/types/domain";
import { DEFAULT_THEME, isThemePreset, themePresetIds } from "@/lib/themes";

const STORAGE_KEY = "capital-command-theme";

interface ThemePresetContextValue {
  theme: ThemePreset;
  setTheme: (theme: ThemePreset) => void;
}

const ThemePresetContext = createContext<ThemePresetContextValue | null>(null);

function applyTheme(theme: ThemePreset) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

export function ThemePresetProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreset>(DEFAULT_THEME);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const next = isThemePreset(stored) ? stored : DEFAULT_THEME;
    applyTheme(next);
    const timer = window.setTimeout(() => {
      setThemeState(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setTheme = useCallback((next: ThemePreset) => {
    setThemeState(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return <ThemePresetContext.Provider value={{ theme, setTheme }}>{children}</ThemePresetContext.Provider>;
}

export function useThemePreset() {
  const context = useContext(ThemePresetContext);
  if (!context) {
    throw new Error("useThemePreset must be used inside ThemePresetProvider");
  }
  return context;
}

/** Inline, render-blocking script that applies the stored theme before paint to avoid a flash. */
export function ThemePresetScript() {
  const valid = JSON.stringify(themePresetIds);
  const script = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var valid=${valid};document.documentElement.dataset.theme=valid.indexOf(t)>-1?t:'${DEFAULT_THEME}';}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
