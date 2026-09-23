"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ThemePreset } from "@/types/domain";
import { DEFAULT_THEME, LEGACY_THEME_IDS, isThemePreset, normalizeThemePreset, themePresetIds } from "@/lib/themes";

const STORAGE_KEY = "capital-command-theme";
const HOST_KEY = "capital-command-host-theme";
export const HOST_THEME_MESSAGE = "colateral:theme";
export const HOST_THEME_PARAM = "theme";
export const HOST_SURFACE_PARAM = "surface";
export const HOST_GLASS_LEVEL_PARAM = "glassLevel";
const HOST_APPEARANCE_KEY = "capital-command-host-appearance";
const DEFAULT_GLASS_LEVEL = 60;

export type HostSurface = "glass" | "classic";

export interface HostAppearance {
  surface: HostSurface;
  glassLevel: number;
}

const DEFAULT_APPEARANCE: HostAppearance = { surface: "glass", glassLevel: DEFAULT_GLASS_LEVEL };

function parseSurface(value: unknown): HostSurface | null {
  return value === "glass" || value === "classic" ? value : null;
}

function parseGlassLevel(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function mergeHostAppearance(base: HostAppearance, input: { surface?: unknown; glassLevel?: unknown }): HostAppearance {
  return {
    surface: parseSurface(input.surface) ?? base.surface,
    glassLevel: parseGlassLevel(input.glassLevel) ?? base.glassLevel,
  };
}

function applyAppearance(appearance: HostAppearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.surface = appearance.surface;
  root.dataset.glass = appearance.glassLevel === 0 ? "flat" : "on";
  root.style.setProperty("--glass-level", String(appearance.glassLevel));
}

function readStoredAppearance(): HostAppearance {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(HOST_APPEARANCE_KEY) ?? "null") as unknown;
    if (stored && typeof stored === "object") return mergeHostAppearance(DEFAULT_APPEARANCE, stored);
  } catch {
    return DEFAULT_APPEARANCE;
  }
  return DEFAULT_APPEARANCE;
}

function storeAppearance(appearance: HostAppearance) {
  try {
    window.sessionStorage.setItem(HOST_APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    return;
  }
}

function readHostAppearance(): HostAppearance {
  const stored = readStoredAppearance();
  try {
    const params = new URLSearchParams(window.location.search);
    const next = mergeHostAppearance(stored, {
      surface: params.get(HOST_SURFACE_PARAM),
      glassLevel: params.get(HOST_GLASS_LEVEL_PARAM),
    });
    if (params.has(HOST_SURFACE_PARAM) || params.has(HOST_GLASS_LEVEL_PARAM)) storeAppearance(next);
    return next;
  } catch {
    return stored;
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
    applyAppearance(readHostAppearance());
    const timer = window.setTimeout(() => {
      setThemeState(next);
      setHosted(fromHost !== null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; theme?: unknown; surface?: unknown; glassLevel?: unknown } | null;
      if (!data || data.type !== HOST_THEME_MESSAGE) return;
      if ("surface" in data || "glassLevel" in data) {
        const appearance = mergeHostAppearance(readStoredAppearance(), data);
        storeAppearance(appearance);
        applyAppearance(appearance);
      }
      if (!isThemePreset(data.theme)) return;
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
    `var d=document.documentElement;d.dataset.theme=t||'${DEFAULT_THEME}';` +
    `var a={surface:'glass',glassLevel:${DEFAULT_GLASS_LEVEL}};` +
    `function lv(v){if(v===null||v===undefined||v==='')return null;var n=Number(v);return isFinite(n)?Math.min(100,Math.max(0,Math.round(n))):null}` +
    `function mg(o){if(!o)return;if(o.surface==='glass'||o.surface==='classic')a.surface=o.surface;var n=lv(o.glassLevel);if(n!==null)a.glassLevel=n}` +
    `try{mg(JSON.parse(sessionStorage.getItem('${HOST_APPEARANCE_KEY}')));var q=new URLSearchParams(location.search);` +
    `if(q.has('${HOST_SURFACE_PARAM}')||q.has('${HOST_GLASS_LEVEL_PARAM}')){mg({surface:q.get('${HOST_SURFACE_PARAM}'),glassLevel:q.get('${HOST_GLASS_LEVEL_PARAM}')});sessionStorage.setItem('${HOST_APPEARANCE_KEY}',JSON.stringify(a))}}catch(e){}` +
    `d.dataset.surface=a.surface;d.dataset.glass=a.glassLevel===0?'flat':'on';d.style.setProperty('--glass-level',String(a.glassLevel));})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
