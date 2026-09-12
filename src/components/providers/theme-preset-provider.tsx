"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ThemePreset } from "@/types/domain";
import { DEFAULT_THEME, LEGACY_THEME_IDS, isThemePreset, normalizeThemePreset, themePresetIds } from "@/lib/themes";
import { THEME_TOKEN_NAMES, sanitizeThemeTokens } from "@/lib/colateral/protocol";

const STORAGE_KEY = "capital-command-theme";
const HOST_KEY = "capital-command-host-theme";
export const HOST_THEME_PARAM = "theme";

interface ThemePresetContextValue {
  theme: ThemePreset;
  setTheme: (theme: ThemePreset) => void;
  /** True while CoLateral is choosing the theme for this frame. */
  hosted: boolean;
}

/**
 * The half of the provider the canvas bridge drives. It is a separate context
 * from the one Settings uses so a page cannot accidentally take the host's
 * seat: `applyHostTheme` is the only way in, and only the bridge calls it.
 */
interface HostThemeContextValue {
  /**
   * Take a theme from the host. `theme` is a preset id when the host is on one
   * of the seventeen shared palettes; `tokens` is its resolved colour palette,
   * which is what makes a theme this app has never heard of paint correctly
   * anyway. Either may be empty.
   */
  applyHostTheme: (theme: string, tokens: Record<string, string>) => void;
  /** True once a host has pushed a palette this app did not have a preset for. */
  customPalette: boolean;
}

const ThemePresetContext = createContext<ThemePresetContextValue | null>(null);
const HostThemeContext = createContext<HostThemeContextValue>({
  applyHostTheme: () => {},
  customPalette: false
});

function applyTheme(theme: ThemePreset) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

/**
 * Paint the host's own token values over whichever preset is active.
 * ---------------------------------------------------------------------------
 * A preset id only matches when the canvas is on a theme this app also ships.
 * CoLateral can be on a theme added after this app's last release, and it lets
 * the engineer recolour one; in both cases the id alone would leave the frame
 * visibly out of step with the card around it. So the host also sends the
 * resolved values, and they are written as inline custom properties on <html>,
 * where they beat every `[data-theme]` block in globals.css without editing one.
 *
 * Written one property at a time through `setProperty` rather than as a style
 * string: the names come from a fixed allowlist and the values are checked by
 * `sanitizeThemeTokens`, and this way there is no place a value could close a
 * declaration and open another. Clearing is by the same allowlist, so a host
 * that stops sending a token releases it back to the preset.
 */
function applyHostTokens(tokens: Record<string, string>) {
  if (typeof document === "undefined") return false;
  const safe = sanitizeThemeTokens(tokens);
  const root = document.documentElement;
  let painted = false;
  for (const name of THEME_TOKEN_NAMES) {
    const value = safe[name];
    if (value) {
      root.style.setProperty(name, value);
      painted = true;
    } else {
      root.style.removeProperty(name);
    }
  }
  return painted;
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
  const [customPalette, setCustomPalette] = useState(false);
  // The host's palette outranks the picker, so a theme chosen in Settings while
  // framed must not silently repaint half the app. `setTheme` clears it.
  const hostTokens = useRef<Record<string, string>>({});

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

  // There is no `message` listener here any more. Inbound host messages are
  // read in one place — ColateralBridgeProvider — which validates the sender
  // and the shape once and then calls `applyHostTheme`. Two listeners for one
  // message meant two different ideas of what a valid theme message was, and
  // only one of them knew about token palettes.

  const setTheme = useCallback((next: ThemePreset) => {
    setThemeState(next);
    applyTheme(next);
    // Picking a theme in here is a decision about this app, so it releases the
    // host's overlay: leaving it on would show the picker's name while the
    // page kept the canvas's colours.
    hostTokens.current = {};
    applyHostTokens({});
    setCustomPalette(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the theme still applies for this page */
    }
  }, []);

  const applyHostTheme = useCallback((next: string, tokens: Record<string, string>) => {
    if (isThemePreset(next)) {
      try {
        window.sessionStorage.setItem(HOST_KEY, next);
      } catch {
        /* a frame without storage still repaints */
      }
      applyTheme(next);
      setThemeState(next);
      setHosted(true);
    }
    // An empty token map is a host saying "preset only", not a host saying
    // nothing: it releases whatever overlay was painted before.
    hostTokens.current = tokens;
    const painted = applyHostTokens(tokens);
    setCustomPalette(painted && !isThemePreset(next));
    if (painted) setHosted(true);
  }, []);

  const hostValue = useMemo(() => ({ applyHostTheme, customPalette }), [applyHostTheme, customPalette]);

  return (
    <ThemePresetContext.Provider value={{ theme, setTheme, hosted }}>
      <HostThemeContext.Provider value={hostValue}>{children}</HostThemeContext.Provider>
    </ThemePresetContext.Provider>
  );
}

export function useHostTheme(): HostThemeContextValue {
  return useContext(HostThemeContext);
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
