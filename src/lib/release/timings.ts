export type UpdateTimingDetail = { label: string; durationMs: number };
export type UpdateTimingStep = {
  label: string;
  durationMs: number | null;
  status: "running" | "completed" | "failed";
  details: UpdateTimingDetail[];
};
export type UpdateTiming = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: "running" | "completed" | "failed" | "unchanged" | "prepared";
  steps: UpdateTimingStep[];
};

export function formatUpdateDuration(durationMs: number | null): string {
  if (durationMs === null) return "Not recorded";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function slowestUpdateStep(steps: UpdateTimingStep[]): UpdateTimingStep | null {
  return steps.reduce<UpdateTimingStep | null>((slowest, step) =>
    step.durationMs !== null && (slowest === null || step.durationMs > (slowest.durationMs ?? 0)) ? step : slowest, null);
}
