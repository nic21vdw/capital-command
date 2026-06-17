import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-white outline-none ring-0 placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]",
        props.className
      )}
    />
  );
}
