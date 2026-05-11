import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[var(--accent)]",
        props.className
      )}
    />
  );
}
