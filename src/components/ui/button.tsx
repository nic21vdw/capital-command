import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-[var(--accent)] text-black hover:bg-[var(--accent-strong)]",
  secondary: "bg-white/6 text-white hover:bg-white/10",
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
        "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
