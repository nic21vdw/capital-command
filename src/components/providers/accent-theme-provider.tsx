"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AccentTheme } from "@/types/domain";
import { DEFAULT_ACCENT, isAccentTheme } from "@/lib/themes";

const STORAGE_KEY = "capital-command-accent";

interface AccentContextValue {
  accent: AccentTheme;
  setAccent: (accent: AccentTheme) => void;
}

const AccentContext = createContext<AccentContextValue | null>(null);

function applyAccent(accent: AccentTheme) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.accent = accent;
  }
}

export function AccentThemeProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<AccentTheme>(DEFAULT_ACCENT);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const next = isAccentTheme(stored) ? stored : DEFAULT_ACCENT;
    applyAccent(next);
    const timer = window.setTimeout(() => {
      setAccentState(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setAccent = useCallback((next: AccentTheme) => {
    setAccentState(next);
    applyAccent(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return <AccentContext.Provider value={{ accent, setAccent }}>{children}</AccentContext.Provider>;
}

export function useAccentTheme() {
  const context = useContext(AccentContext);
  if (!context) {
    throw new Error("useAccentTheme must be used inside AccentThemeProvider");
  }
  return context;
}

/** Inline, render-blocking script that applies the stored accent before paint to avoid a flash. */
export function AccentThemeScript() {
  const script = `(function(){try{var a=localStorage.getItem('${STORAGE_KEY}');var valid=['lime','stripe','ocean','sunset','rose','mono'];document.documentElement.dataset.accent=valid.indexOf(a)>-1?a:'${DEFAULT_ACCENT}';}catch(e){document.documentElement.dataset.accent='${DEFAULT_ACCENT}';}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
