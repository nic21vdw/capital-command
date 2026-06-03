"use client";

import { Check, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useAccentTheme } from "@/components/providers/accent-theme-provider";
import { useAppData } from "@/components/providers/app-provider";
import { Card } from "@/components/ui/card";
import { accentThemes } from "@/lib/themes";
import { cn } from "@/lib/utils";

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { accent, setAccent } = useAccentTheme();
  const { theme, setTheme } = useTheme();
  const { data, mutate } = useAppData();

  const onAccent = (id: (typeof accentThemes)[number]["id"]) => {
    setAccent(id);
    void mutate("updateSettings", { ...data.settings, accentTheme: id });
  };

  const onMode = (mode: "light" | "dark") => {
    setTheme(mode);
    void mutate("updateSettings", { ...data.settings, theme: mode });
  };

  const content = (
    <div className="space-y-4">
      <div>
        <p className="mb-3 text-sm text-[var(--muted-foreground)]">Accent theme</p>
        <div className="flex flex-wrap gap-2">
          {accentThemes.map((option) => {
            const active = accent === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onAccent(option.id)}
                title={option.description}
                className={cn(
                  "group relative flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition",
                  active
                    ? "border-[var(--accent)] bg-white/8 text-white"
                    : "border-white/10 text-[var(--muted-foreground)] hover:border-white/20 hover:text-white"
                )}
              >
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ background: `linear-gradient(135deg, ${option.swatch}, ${option.swatchStrong})` }}
                />
                {option.label}
                {active ? <Check className="h-3.5 w-3.5 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-3 text-sm text-[var(--muted-foreground)]">Mode</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onMode("dark")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm transition",
              theme === "dark"
                ? "border-[var(--accent)] bg-white/8 text-white"
                : "border-white/10 text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            <Moon className="h-4 w-4" /> Dark
          </button>
          <button
            type="button"
            onClick={() => onMode("light")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm transition",
              theme === "light"
                ? "border-[var(--accent)] bg-white/8 text-white"
                : "border-white/10 text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            <Sun className="h-4 w-4" /> Light
          </button>
        </div>
      </div>
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold text-white">Appearance</h3>
      {content}
    </Card>
  );
}
