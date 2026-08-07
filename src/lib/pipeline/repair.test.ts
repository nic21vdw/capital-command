import { describe, expect, it } from "vitest";
import { REPAIRABLE_STAGES, isRepairableStage, repairableStages } from "@/lib/pipeline/repairable";
import type { PipelineStage, PipelineStageKey } from "@/lib/pipeline/types";

const stages = (overrides: Partial<Record<PipelineStageKey, PipelineStage>>): Record<PipelineStageKey, PipelineStage> => ({
  source: { status: "ready", detail: "" },
  longform: { status: "ready", detail: "" },
  segments: { status: "ready", detail: "" },
  clips: { status: "ready", detail: "" },
  audio: { status: "ready", detail: "" },
  podcast: { status: "ready", detail: "" },
  images: { status: "ready", detail: "" },
  visuals: { status: "ready", detail: "" },
  posts: { status: "ready", detail: "" },
  schedule: { status: "ready", detail: "" },
  ...overrides
});

describe("pipeline repair", () => {
  it("offers a retry for the stages that failed or gave up", () => {
    const found = repairableStages(
      stages({
        longform: { status: "error", detail: "The export failed." },
        audio: { status: "skipped", detail: "The podcast MP3 could not be cut." }
      })
    );
    expect(found.map((item) => item.stage)).toEqual(["longform", "audio"]);
    expect(found[0].detail).toBe("The export failed.");
  });

  it("leaves working and finished stages alone", () => {
    expect(repairableStages(stages({ clips: { status: "running", detail: "Rendering clips…" } }))).toEqual([]);
    expect(repairableStages(stages({ posts: { status: "waiting", detail: "" } }))).toEqual([]);
  });

  it("catches an export the server abandoned, which still reads as rendering", () => {
    const found = repairableStages(stages({ longform: { status: "running", detail: "Rendering the edited video…" } }), {
      longformStalled: true
    });
    expect(found.map((item) => item.stage)).toEqual(["longform"]);
    expect(found[0].status).toBe("error");
  });

  it("never offers to republish the podcast episode", () => {
    expect(REPAIRABLE_STAGES).not.toContain("podcast");
    expect(repairableStages(stages({ podcast: { status: "error", detail: "The feed rejected it." } }))).toEqual([]);
    expect(isRepairableStage("podcast")).toBe(false);
    expect(isRepairableStage("longform")).toBe(true);
  });
});
