import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Tones come from the active theme, not from Tailwind's palette: `--success`
 * and friends are declared per preset in globals.css from CoLateral's own
 * --green / --amber / --red / --indigo, so a "ready" badge is Gruvbox green on
 * Gruvbox. A badge with no tone is the quiet neutral this component always was.
 */
export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
  info: "tone-info",
  accent: "tone-accent"
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  if (tone === "neutral") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-xs font-medium text-[var(--muted-foreground)]",
          className
        )}
        {...props}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        "border-[color-mix(in_srgb,var(--tone)_34%,transparent)] bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] text-[var(--tone)]",
        TONE_CLASS[tone],
        className
      )}
      {...props}
    />
  );
}
