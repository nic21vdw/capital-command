import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,var(--card-from),var(--card-to))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
}
