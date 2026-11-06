import type { ExperimentReport, VariantReport, VariantState } from "@/lib/experiments/evaluate";
import { KIND_LABEL, type DecisionReason } from "@/lib/experiments/types";

export type ExperimentGroups = { running: ExperimentReport[]; decided: ExperimentReport[]; inconclusive: ExperimentReport[] };

export function experimentGroups(reports: ExperimentReport[]): ExperimentGroups {
  return {
    running: reports.filter((entry) => entry.status === "running"),
    decided: reports.filter((entry) => entry.status === "decided"),
    inconclusive: reports.filter((entry) => entry.status === "inconclusive")
  };
}

export function statusCounts(reports: ExperimentReport[]): string {
  if (reports.length === 0) return "No experiments yet";
  const groups = experimentGroups(reports);
  return `${groups.running.length} running, ${groups.decided.length} decided, ${groups.inconclusive.length} inconclusive`;
}

export function experimentTitle(report: ExperimentReport): string {
  return `${KIND_LABEL[report.kind]} test: ${report.source.label}`;
}

const STATE_LABEL: Record<VariantState, string> = {
  scheduled: "Scheduled",
  measuring: "Measuring",
  waiting: "Waiting for the next sync",
  measured: "Measured",
  removed: "Taken off the schedule",
  failed: "Did not go out",
  unmeasured: "Could not be measured"
};

export function variantStateLabel(state: VariantState): string {
  return STATE_LABEL[state];
}

const REASON_LABEL: Record<DecisionReason, string> = {
  winner: "Winner",
  tie: "Too close to call",
  "not-enough-data": "Not enough data",
  removed: "A variant never went out",
  confounded: "Variants too close in time",
  unmeasured: "Could not be measured"
};

export function reasonLabel(reason: DecisionReason | null): string {
  return reason === null ? "Running" : REASON_LABEL[reason];
}

export function shortDate(iso: string, timeZone = "UTC"): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(new Date(time));
}

export function variantLine(variant: VariantReport, timeZone = "UTC"): string {
  const head = `${variant.id} "${variant.value}"`;
  if (variant.state === "measured" && variant.views !== null) {
    const index = variant.viewsIndex === null ? "" : `, ${variant.viewsIndex.toFixed(1)}x a typical post`;
    return `${head}: ${Math.round(variant.views).toLocaleString("en-US")} views${index}`;
  }
  if (variant.state === "measuring" && variant.windowEndsAt) return `${head}: Measuring until ${shortDate(variant.windowEndsAt, timeZone)}`;
  return `${head}: ${variantStateLabel(variant.state)}`;
}
