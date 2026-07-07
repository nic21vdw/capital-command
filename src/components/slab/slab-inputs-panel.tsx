"use client";

import { OCCUPANCIES, type SlabInput } from "@/lib/slab/design";

interface Props {
  input: SlabInput;
  onChange: (patch: Partial<SlabInput>) => void;
  onReset: () => void;
}

function Field({
  label,
  value,
  unit,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</span>
      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] focus-within:border-[var(--accent)]">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-9 w-full bg-transparent px-2.5 text-sm text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit ? <span className="pr-2.5 text-xs text-[var(--muted-foreground)]">{unit}</span> : null}
      </div>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5 border-t border-[var(--border)] px-4 py-3.5 first:border-t-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{title}</p>
      {children}
    </div>
  );
}

export function SlabInputsPanel({ input, onChange, onReset }: Props) {
  const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  const suggested = Math.round((Math.max(input.lx, input.ly) - input.columnSize) / 30 / 10) * 10;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Inputs</h2>
        <button type="button" onClick={onReset} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] transition hover:text-white">
          Reset
        </button>
      </div>

      <Section title="Slab geometry">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lx" value={input.lx} unit="mm" step={100} onChange={(v) => onChange({ lx: num(v, input.lx) })} />
          <Field label="Ly" value={input.ly} unit="mm" step={100} onChange={(v) => onChange({ ly: num(v, input.ly) })} />
        </div>
        <Field label="Thickness h" value={input.h} unit="mm" step={5} onChange={(v) => onChange({ h: num(v, input.h) })} />
        <Field label="Column size" value={input.columnSize} unit="mm" step={25} onChange={(v) => onChange({ columnSize: num(v, input.columnSize) })} />
        {input.h < suggested ? (
          <button
            type="button"
            onClick={() => onChange({ h: suggested })}
            className="w-full rounded-md bg-amber-500/10 px-2 py-1.5 text-left text-[11px] text-amber-300 transition hover:bg-amber-500/20"
          >
            Suggest h ≈ ℓn/30 = {suggested}mm — tap to apply
          </button>
        ) : null}
      </Section>

      <Section title="Materials (CSA A23.3-19)">
        <div className="grid grid-cols-2 gap-2">
          <Field label="f′c" value={input.fc} unit="MPa" onChange={(v) => onChange({ fc: num(v, input.fc) })} />
          <Field label="fy" value={input.fy} unit="MPa" step={5} onChange={(v) => onChange({ fy: num(v, input.fy) })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Cover top" value={input.coverTop} unit="mm" step={5} onChange={(v) => onChange({ coverTop: num(v, input.coverTop) })} />
          <Field label="Cover bot" value={input.coverBottom} unit="mm" step={5} onChange={(v) => onChange({ coverBottom: num(v, input.coverBottom) })} />
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">φc = 0.65 · φs = 0.85 (Cl. 8.4.2)</p>
      </Section>

      <Section title="Loads (NBCC 2020)">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Occupancy</span>
          <select
            // Keyed on the label (unique) rather than the live load: several
            // occupancies share the same kPa, so a value-keyed select would be
            // ambiguous. A manual LL edit that matches no preset shows "Custom".
            value={OCCUPANCIES.find((o) => o.live === input.live)?.label ?? "__custom"}
            onChange={(e) => {
              const match = OCCUPANCIES.find((o) => o.label === e.target.value);
              if (match) onChange({ live: match.live });
            }}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm text-white outline-none focus:border-[var(--accent)]"
          >
            {OCCUPANCIES.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
            <option value="__custom">Custom live load</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label="SDL" value={input.sdl} unit="kPa" step={0.1} onChange={(v) => onChange({ sdl: num(v, input.sdl) })} />
          <Field label="Live" value={input.live} unit="kPa" step={0.1} onChange={(v) => onChange({ live: num(v, input.live) })} />
        </div>
      </Section>
    </div>
  );
}
