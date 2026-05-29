"use client";

import { Card } from "@/components/ui/card";

export function XPProgressBar({
  level,
  xpIntoLevel,
  xpToNextLevel,
  percent,
  totalXP
}: {
  level: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  percent: number;
  totalXP: number;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 -bottom-32 h-64 opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(213,255,127,0.35), transparent 60%)" }}
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">Level</p>
            <p className="text-3xl font-semibold text-white">L{level}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">Total XP</p>
            <p className="text-xl font-semibold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
              {totalXP.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(100, Math.max(0, percent))}%`,
              background:
                "linear-gradient(90deg, var(--accent-strong), var(--accent) 60%, #7de2d1 100%)",
              boxShadow: "0 0 24px rgba(213,255,127,0.45)"
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--muted-foreground)]">
          <span>{xpIntoLevel} / 500 XP this level</span>
          <span>{xpToNextLevel} XP to L{level + 1}</span>
        </div>
      </div>
    </Card>
  );
}
