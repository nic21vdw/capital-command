"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw, X } from "lucide-react";
import { formatUpdateDuration, slowestUpdateStep, type UpdateTiming } from "@/lib/release/timings";

const outcomes: Record<UpdateTiming["status"], string> = {
  running: "Not finished", completed: "Updated", failed: "Failed", unchanged: "No changes", prepared: "Prepared without restart"
};

export function UpdateHistory({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState<UpdateTiming[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 8000);
    void fetch("/api/update/history", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Update history could not be read. Try again.");
      const body = await response.json() as { updates: UpdateTiming[] };
      if (active) setUpdates(body.updates);
    }).catch(() => {
      if (active) setError("Update history could not be read. Try again.");
    }).finally(() => {
      clearTimeout(timer);
      if (active) setLoading(false);
    });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [open, refresh]);

  return (
    <>
      <button type="button" onClick={() => { setLoading(true); setError(null); setOpen(true); }} title="Update history" aria-label="Update history"
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white">
        <Clock3 className="h-4 w-4 shrink-0" />
        {!collapsed && <span>Update history</span>}
      </button>
      {open && (
        <dialog ref={dialog} aria-labelledby="update-history-title" onCancel={(event) => { event.preventDefault(); close(); }}
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}
          className="w-[calc(100%_-_2rem)] max-w-xl bg-transparent p-0 text-white backdrop:bg-black/60">
          <section
            className="glass-popover w-full max-w-xl rounded-xl border border-[var(--border)] p-4 text-white">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="update-history-title" className="text-base font-semibold">Update history</h2>
              <div className="flex gap-2">
                <button type="button" aria-label="Refresh update history" disabled={loading} onClick={() => { setLoading(true); setError(null); setRefresh((value) => value + 1); }} className="rounded p-1.5 hover:bg-white/10 disabled:opacity-40">
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button type="button" aria-label="Close update history" onClick={close} className="rounded p-1.5 hover:bg-white/10"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
              {loading && updates.length === 0 && <p role="status" className="text-sm text-[var(--muted-foreground)]">Loading update history...</p>}
              {!loading && !error && updates.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No timings saved yet. Your next update will record each step here.</p>}
              {updates.map((update) => {
                const slowest = slowestUpdateStep(update.steps);
                return (
                  <details key={update.id} className="rounded-lg border border-[var(--border)] p-3">
                    <summary className="cursor-pointer text-sm">
                      <span>{new Date(update.startedAt).toLocaleString()} - {outcomes[update.status]}</span>
                      <span className="ml-2 font-mono text-[var(--muted-foreground)]">{formatUpdateDuration(update.durationMs)}</span>
                      {slowest && <p className="mt-1 text-xs text-[var(--muted-foreground)]">Most time: {slowest.label} ({formatUpdateDuration(slowest.durationMs)})</p>}
                    </summary>
                    <table className="mt-3 w-full text-left text-xs">
                      <thead><tr className="text-[var(--muted-foreground)]"><th className="py-1 font-medium">Step</th><th className="py-1 text-right font-medium">Duration</th></tr></thead>
                      <tbody>{update.steps.map((step, index) => (
                        <tr key={index}>
                          <td className="border-t border-[var(--border)] py-2 pr-3">
                            {step.label}{step.status === "failed" && <span className="ml-2 text-amber-300">Failed</span>}
                            {step.details.map((detail, detailIndex) => <div key={detailIndex} className="mt-1 text-[var(--muted-foreground)]">{detail.label}: {formatUpdateDuration(detail.durationMs)}</div>)}
                          </td>
                          <td className="border-t border-[var(--border)] py-2 text-right align-top font-mono">{formatUpdateDuration(step.durationMs)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {update.status === "running" && <p className="mt-2 text-xs text-[var(--muted-foreground)]">This update has no completion record. It may still be running or may have been interrupted.</p>}
                  </details>
                );
              })}
            </div>
          </section>
        </dialog>
      )}
    </>
  );
}
