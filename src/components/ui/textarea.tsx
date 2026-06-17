import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-28 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-sm text-white outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]",
        props.className
      )}
    />
  );
}
