import type { PipelineStage, PipelineStageKey, StageRepair } from "@/lib/pipeline/types";

// Which stages can be run again, decided from the overview alone. This is the
// leaf both halves read: `runs.ts` puts the answer on every overview, and
// `repair.ts` acts on it. Nothing here touches a store, so the page and the
// orchestrator can never disagree about what is offered.
//
// `podcast` is deliberately absent: that stage publishes the episode to the
// feed, and republishing is not a button anything here gets to press.

export const REPAIRABLE_STAGES = ["longform", "segments", "clips", "audio", "images", "posts"] as const;

export type RepairableStage = (typeof REPAIRABLE_STAGES)[number];

export function isRepairableStage(value: string): value is RepairableStage {
  return (REPAIRABLE_STAGES as readonly string[]).includes(value);
}

/**
 * A stage that failed or gave up is worth another attempt; one that is ready has
 * nothing to fix and one still working must be left alone. `longformStalled`
 * covers the case the stage cannot see for itself: an export record left
 * `processing` by a server that stopped mid-render reads as "Rendering the
 * edited video…" forever.
 */
export function repairableStages(
  stages: Record<PipelineStageKey, PipelineStage>,
  options: { longformStalled?: boolean } = {}
): StageRepair[] {
  const repairs: StageRepair[] = [];
  for (const stage of REPAIRABLE_STAGES) {
    const current = stages[stage];
    if (!current) continue;
    if (current.status === "error" || current.status === "skipped") {
      repairs.push({ stage, status: current.status, detail: current.detail });
    } else if (stage === "longform" && options.longformStalled === true) {
      repairs.push({ stage, status: "error", detail: "The export stopped when the server restarted." });
    }
  }
  return repairs;
}
