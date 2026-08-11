import { describe, expect, it } from "vitest";
import { screenTakesStream, streamHref, streamProgressLabel, summarizeStream } from "@/lib/pipeline/streams";
import type { PipelineRun, PipelineRunOverview, PipelineStage, PipelineStageKey, StreamSummary } from "@/lib/pipeline/types";

const stage = (status: PipelineStage["status"]): PipelineStage => ({ status, detail: "" });

const overview = (over: {
  run?: Partial<PipelineRun>;
  stages?: Partial<Record<PipelineStageKey, PipelineStage>>;
  retryable?: PipelineRunOverview["retryable"];
  settled?: boolean;
}): PipelineRunOverview =>
  ({
    run: {
      id: "run-1",
      name: "Day 21",
      status: "running",
      notices: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      ...over.run
    } as PipelineRun,
    stages: {
      source: stage("ready"),
      longform: stage("waiting"),
      segments: stage("waiting"),
      clips: stage("waiting"),
      audio: stage("waiting"),
      podcast: stage("waiting"),
      images: stage("waiting"),
      visuals: stage("waiting"),
      posts: stage("waiting"),
      schedule: stage("waiting"),
      ...over.stages
    } as Record<PipelineStageKey, PipelineStage>,
    retryable: over.retryable ?? [],
    schedulable: {} as PipelineRunOverview["schedulable"],
    settled: over.settled ?? false
  }) as PipelineRunOverview;

const summary = (over: Partial<StreamSummary> = {}): StreamSummary => ({
  id: "run-1",
  name: "Day 21",
  status: "running",
  settled: false,
  needsAttention: false,
  ready: 0,
  total: 7,
  posts: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...over
});

describe("summarizing a stream for the shell", () => {
  it("counts finished formats, and never counts a skip against them", () => {
    const entry = summarizeStream(
      overview({
        stages: { longform: stage("ready"), clips: stage("ready"), posts: stage("skipped") }
      })
    );
    expect(entry.ready).toBe(2);
    // 7 deliverable stages, one skipped by design.
    expect(entry.total).toBe(6);
  });

  it("carries the ids each screen needs to find this stream's piece", () => {
    const entry = summarizeStream(
      overview({ run: { longformProjectId: "lf-9", clipJobId: "job-9", carouselId: "car-9" } })
    );
    expect(entry.longformProjectId).toBe("lf-9");
    expect(entry.clipJobId).toBe("job-9");
    expect(entry.carouselId).toBe("car-9");
  });

  it("flags a stream that is asking for something", () => {
    expect(summarizeStream(overview({ run: { status: "error" } })).needsAttention).toBe(true);
    expect(
      summarizeStream(overview({ retryable: [{ stage: "clips", status: "error", detail: "" }] })).needsAttention
    ).toBe(true);
    expect(
      summarizeStream(overview({ run: { queueFailures: [{ title: "Everything", error: "no slot" }] } }))
        .needsAttention
    ).toBe(true);
    expect(summarizeStream(overview({})).needsAttention).toBe(false);
  });
});

describe("carrying the stream from screen to screen", () => {
  it("points each screen at the id that screen actually reads", () => {
    const stream = summary({ longformProjectId: "lf-9", clipJobId: "job-9" });
    expect(streamHref("/longform", stream)).toBe("/longform?open=lf-9");
    expect(streamHref("/clips", stream)).toBe("/clips?job=job-9");
    expect(streamHref("/editor", stream)).toBe("/editor?job=job-9");
    expect(streamHref("/carousels", stream)).toBe("/carousels?longform=lf-9");
    expect(streamHref("/podcast", stream)).toBe("/podcast?project=lf-9");
    expect(streamHref("/uploading-center", stream)).toBe("/uploading-center?job=job-9");
    expect(streamHref("/", stream)).toBe("/?run=run-1");
  });

  it("leaves a screen alone when this stream has nothing there yet", () => {
    // A filter matching nothing reads as "this stream made no clips", when the
    // truth is that the clip job has not been created.
    expect(streamHref("/clips", summary())).toBe("/clips");
    expect(streamHref("/longform", summary())).toBe("/longform");
  });

  it("leaves screens that are not about one stream alone", () => {
    const stream = summary({ longformProjectId: "lf-9", clipJobId: "job-9" });
    expect(streamHref("/x-posts", stream)).toBe("/x-posts");
    expect(streamHref("/launch", stream)).toBe("/launch");
    expect(streamHref("/music", stream)).toBe("/music");
    expect(screenTakesStream("/x-posts")).toBe(false);
    expect(screenTakesStream("/clips")).toBe(true);
  });

  it("does nothing without a stream picked", () => {
    expect(streamHref("/clips", null)).toBe("/clips");
  });
});

describe("how far along a stream reads", () => {
  it("leads with what is wrong, then what is left", () => {
    expect(streamProgressLabel(summary({ status: "error" }))).toBe("Needs attention");
    expect(streamProgressLabel(summary({ needsAttention: true }))).toBe("Needs attention");
    expect(streamProgressLabel(summary({ status: "ingesting" }))).toBe("Importing…");
    expect(streamProgressLabel(summary({ settled: true }))).toBe("Ready to schedule");
    expect(streamProgressLabel(summary({ ready: 3, total: 7 }))).toBe("3 of 7 formats ready");
  });

  it("does not call a broken stream finished", () => {
    expect(streamProgressLabel(summary({ settled: true, needsAttention: true }))).toBe("Needs attention");
  });
});
