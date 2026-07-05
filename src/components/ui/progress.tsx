import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  const active = clamped > 0 && clamped < 100;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-white/10", className)}>
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
        style={{
          width: `${clamped}%`,
          // A quiet moving sheen while work is in flight, so progress reads
          // as alive even when the percentage holds still for a bit.
          backgroundImage: active
            ? "linear-gradient(135deg, rgba(255,255,255,0.18) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.18) 75%, transparent 75%, transparent)"
            : undefined,
          backgroundSize: active ? "32px 32px" : undefined,
          animation: active ? "progress-sheen 1.2s linear infinite" : undefined
        }}
      />
    </div>
  );
}
