import { describe, expect, it } from "vitest";
import { runProgress } from "@/lib/pipeline/progress";
import type { PipelineRunOverview, PipelineStageKey, PipelineStageStatus } from "@/lib/pipeline/types";

const STAGES: PipelineStageKey[] = [
  "source",
  "longform",
  "segments",
  "clips",
  "audio",
  "podcast",
  "images",
  "visuals",
  "posts",
  "schedule"
];

const entry = (over: {
  stageStatus?: PipelineStageStatus;
  schedulable?: Partial<PipelineRunOverview["schedulable"]>;
  delivery?: Partial<PipelineRunOverview["delivery"]>;
}): PipelineRunOverview =>
  ({
    stages: Object.fromEntries(
      STAGES.map((key) => [key, { status: over.stageStatus ?? "ready", detail: "" }])
    ),
    delivery: { booked: 0, posted: 0, uploading: 0, failed: 0, ...over.delivery },
    schedulable: {
      clipsReady: 0,
      longformReady: false,
      segments: 0,
      segmentsRendered: 0,
      audioReady: false,
      podcastPublished: false,
      carouselSlides: 0,
      visualAdReady: false,
      posts: 0,
      queued: 0,
      ...over.schedulable
    }
  }) as PipelineRunOverview;

describe("what a run says about itself in the list", () => {
  it("counts a stage that will never do anything more as done, skips included", () => {
    expect(runProgress(entry({ stageStatus: "ready" })).percent).toBe(100);
    expect(runProgress(entry({ stageStatus: "skipped" })).percent).toBe(100);
    expect(runProgress(entry({ stageStatus: "waiting" })).percent).toBe(0);
  });

  it("names what the run made", () => {
    const progress = runProgress(
      entry({
        schedulable: { clipsReady: 10, longformReady: true, segmentsRendered: 1, carouselSlides: 8, posts: 4 }
      })
    );
    expect(progress.outputs).toEqual(["10 shorts", "long-form", "1 segment", "8-slide carousel", "4 posts"]);
  });

  it("counts rendered segments, not planned ones — a plan is not a video", () => {
    expect(runProgress(entry({ schedulable: { segments: 5, segmentsRendered: 0 } })).outputs).toEqual([]);
  });

  it("says an MP3 is a podcast once it is in the feed", () => {
    expect(runProgress(entry({ schedulable: { audioReady: true } })).outputs).toEqual(["MP3"]);
    expect(
      runProgress(entry({ schedulable: { audioReady: true, podcastPublished: true } })).outputs
    ).toEqual(["podcast"]);
  });

  it("reports what has been booked and what is live", () => {
    expect(runProgress(entry({ delivery: { booked: 12, posted: 5, uploading: 2 } })).delivery).toBe(
      "12 scheduled · 5 live · 2 uploaded"
    );
  });

  // A run that has made nothing yet has nothing to schedule, and saying
  // "nothing scheduled" about it reads as a fault rather than as a young run.
  it("only calls a run unscheduled when it has something to schedule", () => {
    expect(runProgress(entry({})).delivery).toBe("");
    expect(runProgress(entry({ schedulable: { clipsReady: 3 } })).delivery).toBe("Nothing scheduled yet");
  });
});
