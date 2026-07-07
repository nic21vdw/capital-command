"use client";

import type { SlabResult } from "@/lib/slab/design";
import { cn } from "@/lib/utils";

interface Props {
  result: SlabResult;
  onOpenStrip: (direction: "x" | "y") => void;
}

function utilTone(u: number) {
  if (u > 1) return "text-red-300";
  if (u > 0.85) return "text-amber-300";
  return "text-emerald-300";
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className={cn("text-lg font-bold leading-tight", tone)}>{value}</p>
    </div>
  );
}

/** Compact results rail: the three governing checks plus a per-strip summary. */
export function SlabResultsPanel({ result, onOpenStrip }: Props) {
  const strips = [
    { s: result.x.columnStrip, d: "x" as const },
    { s: result.x.middleStrip, d: "x" as const },
    { s: result.y.columnStrip, d: "y" as const },
    { s: result.y.middleStrip, d: "y" as const },
  ];

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Strip util" value={`${(result.maxStripUtil * 100).toFixed(0)}%`} tone={utilTone(result.maxStripUtil)} />
        <Metric label="Punching" value={`${(result.punching.ratio * 100).toFixed(0)}%`} tone={utilTone(result.punching.ratio)} />
        <Metric label="Deflect" value={result.deflection.ok ? "OK" : "CHK"} tone={result.deflection.ok ? "text-emerald-300" : "text-amber-300"} />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
        Factored load <span className="font-semibold text-white">{result.loads.factored.toFixed(2)} kPa</span> · dead{" "}
        {result.loads.dead.toFixed(1)} · live {result.loads.liveLoad.toFixed(1)}
      </div>

      <div className="space-y-1.5">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Design strips</p>
        {strips.map(({ s, d }) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onOpenStrip(d)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left transition hover:border-[var(--border-strong)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white">{s.label}</span>
              <span className={cn("text-xs font-bold", utilTone(s.utilisation))}>{(s.utilisation * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className={cn(
                  "h-full rounded-full",
                  s.utilisation > 1 ? "bg-red-400" : s.utilisation > 0.85 ? "bg-amber-400" : "bg-emerald-400",
                )}
                style={{ width: `${Math.min(s.utilisation, 1.2) * 83}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
              {s.rebar.bar.name} @ {s.rebar.spacing}mm · peak {s.peakMoment.toFixed(1)} kN·m/m
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
