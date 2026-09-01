import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[var(--shadow)] hover:bg-[var(--accent-strong)]",
  secondary: "border border-[var(--border)] bg-white/5 text-white hover:border-[var(--border-strong)] hover:bg-white/10",
  ghost: "bg-transparent text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white",
  danger: "bg-red-500/15 text-red-200 hover:bg-red-500/25"
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
