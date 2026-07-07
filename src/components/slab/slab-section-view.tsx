"use client";

import type { Direction, PunchingResult, SlabResult, StripResult } from "@/lib/slab/design";
import { cn } from "@/lib/utils";

interface Props {
  result: SlabResult;
  direction: Direction;
  units: "mm" | "m";
  onChangeDirection: (d: Direction) => void;
}

function ratioTone(ratio: number) {
  if (ratio > 1) return { text: "text-red-300", stroke: "#f87171", fill: "#f8717133" };
  if (ratio > 0.85) return { text: "text-amber-300", stroke: "#f59e0b", fill: "#f59e0b33" };
  return { text: "text-emerald-300", stroke: "#34d399", fill: "#34d39933" };
}

/**
 * One bending-moment diagram for a design strip. Hogging (negative) is drawn on
 * the tension side above the span, sagging (positive) below — the standard "draw
 * on the tension face" convention. Punching-shear ratios sit at each reaction.
 */
function StripDiagram({
  strip,
  punching,
  units,
}: {
  strip: StripResult;
  punching: PunchingResult;
  units: "mm" | "m";
}) {
  const W = 760;
  const H = 240;
  const left = 96;
  const right = W - 96;
  const baseline = H / 2;
  const amp = 78;
  const maxM = Math.max(strip.negPerMetre, strip.posPerMetre, 1);
  const scale = amp / maxM;

  const xAt = (t: number) => left + t * (right - left);
  const yAt = (m: number) => baseline + m * scale; // +m (sag) drawn downward

  const pts = strip.diagram.map((p) => `${xAt(p.t).toFixed(1)},${yAt(p.m).toFixed(1)}`);
  const area = `M ${xAt(0)},${baseline} L ${pts.join(" L ")} L ${xAt(1)},${baseline} Z`;
  const curve = `M ${pts.join(" L ")}`;

  const tone = ratioTone(punching.ratio);
  const spanLabel = units === "m" ? `${strip.span.toFixed(2)} m` : `${Math.round(strip.span * 1000)} mm`;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{strip.label}</span>
          <span className="text-xs text-[var(--muted-foreground)]">width {strip.width.toFixed(2)} m</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md bg-[var(--surface-2)] px-2 py-0.5 font-medium text-white">{strip.rebar.bar.name} @ {strip.rebar.spacing}mm</span>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 font-semibold",
              strip.utilisation > 1 ? "bg-red-500/15 text-red-300" : strip.utilisation > 0.85 ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300",
            )}
          >
            {(strip.utilisation * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
        {/* Span line + supports (columns) */}
        <line x1={left} y1={baseline} x2={right} y2={baseline} stroke="var(--border-strong)" strokeWidth={1.5} />
        {[0, 1].map((t) => (
          <rect key={t} x={xAt(t) - 8} y={baseline - 8} width={16} height={16} rx={2} fill="var(--accent)" fillOpacity={0.85} />
        ))}

        {/* Moment area + curve */}
        <path d={area} fill="var(--accent)" fillOpacity={0.14} />
        <path d={curve} fill="none" stroke="var(--accent)" strokeWidth={2.5} />

        {/* Peak labels */}
        <text x={xAt(0)} y={yAt(-strip.negPerMetre) - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--color-white)">
          −{strip.negPerMetre.toFixed(1)}
        </text>
        <text x={xAt(1)} y={yAt(-strip.negPerMetre) - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--color-white)">
          −{strip.negPerMetre.toFixed(1)}
        </text>
        <text x={xAt(0.5)} y={yAt(strip.posPerMetre) + 18} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--color-white)">
          +{strip.posPerMetre.toFixed(1)}
        </text>
        <text x={xAt(0.5)} y={baseline - amp - 10} textAnchor="middle" fontSize={10.5} fill="var(--muted-foreground)">
          kN·m/m (hogging −, sagging +)
        </text>
        <text x={xAt(0.5)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
          clear span ℓn = {spanLabel}
        </text>

        {/* Punching-shear reaction badges */}
        {[0, 1].map((t) => (
          <g key={`p${t}`}>
            <rect x={xAt(t) - 40} y={t === 0 ? baseline + 26 : baseline + 26} width={80} height={30} rx={6} fill={tone.fill} stroke={tone.stroke} strokeWidth={1} />
            <text x={xAt(t)} y={baseline + 39} textAnchor="middle" fontSize={9.5} fill="var(--muted-foreground)">Vf / Vc</text>
            <text x={xAt(t)} y={baseline + 51} textAnchor="middle" fontSize={12} fontWeight={700} fill={tone.stroke}>
              {(punching.ratio * 100).toFixed(0)}%
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function SlabSectionView({ result, direction, units, onChangeDirection }: Props) {
  const dir = direction === "x" ? result.x : result.y;
  const punching = result.punching;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Section {direction === "x" ? "A–A" : "B–B"} · {direction === "x" ? "Lx" : "Ly"} span
          </h3>
          <p className="text-xs text-[var(--muted-foreground)]">Bending-moment diagrams with punching shear at each column.</p>
        </div>
        <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-xs">
          {(["x", "y"] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChangeDirection(d)}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition",
                direction === d ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)] hover:text-white",
              )}
            >
              {d === "x" ? "A–A" : "B–B"}
            </button>
          ))}
        </div>
      </div>

      <StripDiagram strip={dir.columnStrip} punching={punching} units={units} />
      <StripDiagram strip={dir.middleStrip} punching={punching} units={units} />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--muted-foreground)]">
        <p>
          Static moment M₀ = <span className="text-white">{dir.mo.toFixed(0)} kN·m</span> · negative{" "}
          <span className="text-white">{dir.negTotal.toFixed(0)}</span> · positive{" "}
          <span className="text-white">{dir.posTotal.toFixed(0)}</span>. Punching perimeter b₀ ={" "}
          <span className="text-white">{punching.bo.toFixed(0)} mm</span> (d = {punching.d.toFixed(0)} mm), vf ={" "}
          <span className="text-white">{punching.vfStress.toFixed(2)}</span> / vc ={" "}
          <span className="text-white">{punching.vc.toFixed(2)} MPa</span>.
        </p>
      </div>
    </div>
  );
}
