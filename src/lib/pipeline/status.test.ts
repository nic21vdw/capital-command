import { describe, expect, it } from "vitest";
import { runListStatus } from "@/lib/pipeline/status";
import type { PipelineRun, StageRepair } from "@/lib/pipeline/types";

const entry = (over: { status?: PipelineRun["status"]; retryable?: StageRepair[]; settled?: boolean }) => ({
  run: { status: over.status ?? "running" } as PipelineRun,
  retryable: over.retryable ?? [],
  settled: over.settled ?? false
});

const broken: StageRepair = { stage: "longform", status: "error", detail: "The export failed." };

describe("how a run reads in a list", () => {
  it("never calls a run with broken stages finished", () => {
    const status = runListStatus(entry({ retryable: [broken], settled: true }));
    expect(status.tone).toBe("attention");
    expect(status.label).toBe("1 stage needs attention");
  });

  it("counts them", () => {
    const status = runListStatus(
      entry({ retryable: [broken, { ...broken, stage: "clips" }], settled: true })
    );
    expect(status.label).toBe("2 stages need attention");
  });

  it("keeps finished meaning finished", () => {
    expect(runListStatus(entry({ settled: true }))).toEqual({ tone: "done", label: "Finished" });
    expect(runListStatus(entry({})).tone).toBe("working");
  });

  it("puts a failed ingest first", () => {
    expect(runListStatus(entry({ status: "error", settled: true }))).toEqual({
      tone: "attention",
      label: "Needs attention"
    });
  });
});

describe("a booking the app promised and could not do", () => {
  it("never reads as finished", () => {
    const status = runListStatus({
      run: { status: "running", queueFailures: [{ title: "the stream", error: "No free slot." }] } as PipelineRun,
      retryable: [],
      settled: true
    });
    expect(status.tone).toBe("attention");
    expect(status.label).toBe("1 not scheduled");
  });

  it("still leads with a failed ingest", () => {
    const status = runListStatus({
      run: { status: "error", queueFailures: [{ title: "x", error: "y" }] } as PipelineRun,
      retryable: [],
      settled: true
    });
    expect(status.label).toBe("Needs attention");
  });
});
