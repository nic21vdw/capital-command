import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  const active = clamped > 0 && clamped < 100;
  return (
    <div
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full border border-white/8 bg-black/45 shadow-inner",
        className
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div
        className="relative h-full overflow-hidden rounded-full bg-[var(--accent)] shadow-[0_0_18px_color-mix(in_srgb,var(--accent)_45%,transparent)] transition-[width] duration-700 ease-out"
        style={{ width: `${clamped}%` }}
      >
        {active && (
          <span className="absolute inset-y-0 -right-8 w-16 animate-[progress-orbit_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/75 to-transparent blur-[1px]" />
        )}
      </div>
    </div>
  );
}
