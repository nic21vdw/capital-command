"use client";

import { Check } from "lucide-react";
import { useThemePreset } from "@/components/providers/theme-preset-provider";
import { useAppData } from "@/components/providers/app-provider";
import { Card } from "@/components/ui/card";
import { themePresets } from "@/lib/themes";
import { cn } from "@/lib/utils";

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useThemePreset();
  const { data, mutate } = useAppData();

  const onSelect = (id: (typeof themePresets)[number]["id"]) => {
    setTheme(id);
    void mutate("updateSettings", { ...data.settings, themePreset: id });
  };

  const content = (
    <div className={cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {themePresets.map((option) => {
        const active = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            aria-pressed={active}
            className={cn(
              "group relative flex flex-col gap-3 rounded-lg border p-3 text-left transition",
              active
                ? "border-[var(--accent)] bg-white/5"
                : "border-[var(--border)] hover:border-[var(--border-strong)]"
            )}
          >
            {/* Live palette preview built from the theme's own colors. */}
            <span
              className="flex h-14 items-end gap-1.5 overflow-hidden rounded-md border border-black/10 p-2"
              style={{ background: option.background }}
            >
              <span className="h-6 flex-1 rounded-sm" style={{ background: option.surface }} />
              <span className="h-6 w-6 rounded-sm" style={{ background: option.accent }} />
            </span>
            <span className="flex items-center justify-between">
              <span className="flex flex-col">
                <span className="text-sm font-medium text-white">{option.label}</span>
                {!compact && (
                  <span className="text-xs text-[var(--muted-foreground)]">{option.description}</span>
                )}
              </span>
              {active ? <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-white">Theme</h3>
      <p className="mb-4 mt-1 text-sm text-[var(--muted-foreground)]">
        Each theme sets the full palette — background, surfaces, and accent.
      </p>
      {content}
    </Card>
  );
}
