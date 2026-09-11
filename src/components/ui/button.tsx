import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/*
  `danger` was the last variant painting itself Tailwind red rather than the
  theme's: a delete button came out the same red on Gruvbox, Nord and Solarized
  while every other control followed the canvas. It now reads --danger like the
  rest of the status vocabulary (globals.css, "Status tones").

  `success` exists for the confirm half of a destructive pair - "Yes, delete" is
  danger, "Keep" is not - and because a page that wanted a green button was
  reaching for bg-emerald-500/15 by hand.
*/
const variants = {
  primary: "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[var(--shadow)] hover:bg-[var(--accent-strong)]",
  secondary: "border border-[var(--border)] bg-white/5 text-white hover:border-[var(--border-strong)] hover:bg-white/10",
  ghost: "bg-transparent text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white",
  danger:
    "tone-danger bg-[color-mix(in_srgb,var(--tone)_15%,transparent)] text-[var(--tone)] hover:bg-[color-mix(in_srgb,var(--tone)_26%,transparent)]",
  success:
    "tone-success bg-[color-mix(in_srgb,var(--tone)_15%,transparent)] text-[var(--tone)] hover:bg-[color-mix(in_srgb,var(--tone)_26%,transparent)]"
};

export function Button({
  className,
  children,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
