"use client";

import { useMemo, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { DEFAULT_INPUT, type Direction, type SlabInput, designSlab } from "@/lib/slab/design";
import { cn } from "@/lib/utils";
import { SlabInputsPanel } from "./slab-inputs-panel";
import { SlabResultsPanel } from "./slab-results-panel";
import { SlabCanvas } from "./slab-canvas";
import { SlabSectionView } from "./slab-section-view";

type View = "plan" | "section";

export function SlabDesignerPage() {
  const [input, setInput] = useState<SlabInput>(DEFAULT_INPUT);
  const [units, setUnits] = useState<"mm" | "m">("mm");
  const [view, setView] = useState<View>("plan");
  const [sectionDir, setSectionDir] = useState<Direction>("x");
  const [inputsOpen, setInputsOpen] = useState(true);

  const result = useMemo(() => designSlab(input), [input]);

  const patch = (p: Partial<SlabInput>) => setInput((prev) => ({ ...prev, ...p }));
  const openSection = (d: Direction) => {
    setSectionDir(d);
    setView("section");
  };

  return (
    <div className="flex h-[calc(100vh-6.5rem)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setInputsOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
            title={inputsOpen ? "Hide inputs" : "Show inputs"}
          >
            {inputsOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
          <div>
            <h1 className="text-base font-semibold text-white">Concrete Slab Designer</h1>
            <p className="text-[11px] text-[var(--muted-foreground)]">CSA A23.3-19 · NBCC 2020 · Direct Design Method</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-xs">
            {(["plan", "section"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-3 py-1 font-medium capitalize transition",
                  view === v ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)] hover:text-white",
                )}
              >
                {v === "plan" ? "Plan" : "Section cut"}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-xs">
            {(["mm", "m"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnits(u)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition",
                  units === u ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)] hover:text-white",
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {inputsOpen ? (
          <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--panel)]">
            <SlabInputsPanel input={input} onChange={patch} onReset={() => setInput(DEFAULT_INPUT)} />
          </aside>
        ) : null}

        <main className="min-w-0 flex-1 p-3">
          {view === "plan" ? (
            <SlabCanvas input={input} result={result} units={units} onOpenSection={openSection} />
          ) : (
            <SlabSectionView result={result} direction={sectionDir} units={units} onChangeDirection={setSectionDir} />
          )}
        </main>

        <aside className="w-60 shrink-0 border-l border-[var(--border)] bg-[var(--panel)]">
          <SlabResultsPanel result={result} onOpenStrip={openSection} />
        </aside>
      </div>
    </div>
  );
}
