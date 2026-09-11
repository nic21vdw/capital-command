"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ThemePreset } from "@/types/domain";
import { DEFAULT_THEME, LEGACY_THEME_IDS, isThemePreset, normalizeThemePreset, themePresetIds } from "@/lib/themes";

const STORAGE_KEY = "capital-command-theme";
const HOST_KEY = "capital-command-host-theme";
export const HOST_THEME_MESSAGE = "colateral:theme";
export const HOST_THEME_PARAM = "theme";

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
      window.sessionStorage.setItem(HOST_KEY, param);
      return param;
    }
    const stored = window.sessionStorage.getItem(HOST_KEY);
    return isThemePreset(stored) ? stored : null;
  } catch {
    return null;
  }
}

function readOwnTheme(): ThemePreset {
  try {
    return normalizeThemePreset(window.localStorage.getItem(STORAGE_KEY));
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
    const timer = window.setTimeout(() => {
      setThemeState(next);
      setHosted(fromHost !== null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; theme?: unknown } | null;
      if (!data || data.type !== HOST_THEME_MESSAGE || !isThemePreset(data.theme)) return;
      try {
        window.sessionStorage.setItem(HOST_KEY, data.theme);
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
      window.localStorage.setItem(STORAGE_KEY, next);
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
  const valid = JSON.stringify(themePresetIds);
  const legacy = JSON.stringify(LEGACY_THEME_IDS);
  const script =
    `(function(){var valid=${valid};var legacy=${legacy};` +
    `function ok(t){return valid.indexOf(t)>-1}` +
    `var t=null;try{var p=new URLSearchParams(location.search).get('${HOST_THEME_PARAM}');` +
    `if(ok(p)){t=p;sessionStorage.setItem('${HOST_KEY}',p)}` +
    `if(!t){var h=sessionStorage.getItem('${HOST_KEY}');if(ok(h))t=h}` +
    `if(!t){var s=localStorage.getItem('${STORAGE_KEY}');if(s&&legacy[s])s=legacy[s];if(ok(s))t=s}}catch(e){}` +
    `document.documentElement.dataset.theme=t||'${DEFAULT_THEME}';})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
