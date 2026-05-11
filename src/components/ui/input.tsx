import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none ring-0 placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]",
        props.className
      )}
    />
  );
}
