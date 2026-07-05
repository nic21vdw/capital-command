"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-xs font-medium text-[var(--muted-foreground)]">
        {label}
        {hint ? <span className="text-[10px] text-white/40">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <Field label={label} hint={format ? format(value) : String(value)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-sm text-white outline-none focus:border-[var(--accent)]"
      />
    </Field>
  );
}

/**
 * Curated caption/overlay swatches. Kept to a small, opinionated set so the
 * palette stays readable on video instead of an unbounded colour picker.
 * Dracula purple leads the accent row by request.
 */
export const COLOR_SWATCHES: { value: string; label: string }[] = [
  { value: "#ffffff", label: "White" },
  { value: "#000000", label: "Black" },
  { value: "#9aa0aa", label: "Slate" },
  { value: "#bd93f9", label: "Dracula purple" },
  { value: "#7c5cff", label: "Violet" },
  { value: "#ff79c6", label: "Pink" },
  { value: "#ff5c8a", label: "Rose" },
  { value: "#ff9f43", label: "Orange" },
  { value: "#ffd34d", label: "Yellow" },
  { value: "#39e08b", label: "Green" },
  { value: "#8be9fd", label: "Cyan" },
  { value: "#5cc8ff", label: "Blue" }
];

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const current = value.toLowerCase();
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_SWATCHES.map((swatch) => {
          const selected = swatch.value.toLowerCase() === current;
          return (
            <button
              key={swatch.value}
              type="button"
              title={swatch.label}
              aria-label={swatch.label}
              aria-pressed={selected}
              onClick={() => onChange(swatch.value)}
              style={{ backgroundColor: swatch.value }}
              className={cn(
                "h-7 w-7 rounded-md border transition-transform duration-150 hover:scale-110",
                selected ? "border-white ring-2 ring-[var(--accent)]" : "border-white/15"
              )}
            />
          );
        })}
      </div>
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-sm text-white outline-none focus:border-[var(--accent)]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-200",
        checked ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-white" : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-[var(--accent)]" : "bg-white/15"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
            checked && "translate-x-[16px]"
          )}
        />
      </span>
    </button>
  );
}
