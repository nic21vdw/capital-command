import { describe, expect, it } from "vitest";
import { nextSegmentToRender, segmentsRemaining } from "@/lib/pipeline/segments";
import type { LongformExportRecord, LongformTopic } from "@/lib/longform/types";

const topic = (id: string): LongformTopic => ({
  id,
  title: `Segment ${id}`,
  summary: "",
  start: 0,
  end: 600,
  keywords: [],
  titleSource: "ai"
});

const record = (over: Partial<LongformExportRecord>): LongformExportRecord => ({
  id: over.id ?? "x",
  status: over.status ?? "done",
  progress: 100,
  createdAt: "2026-08-06T00:00:00.000Z",
  ...over
});

describe("draining the topic segments", () => {
  it("takes the first one with no finished video", () => {
    const project = {
      topics: [topic("a"), topic("b"), topic("c")],
      exports: [record({ id: "e1", topicId: "a", file: "a.mp4" })]
    };
    expect(nextSegmentToRender(project)?.id).toBe("b");
    expect(segmentsRemaining(project)).toBe(2);
  });

  it("waits while a render is in flight — the engine takes one at a time", () => {
    const project = {
      topics: [topic("a"), topic("b")],
      exports: [record({ id: "e1", status: "processing", topicId: "a" })]
    };
    expect(nextSegmentToRender(project)).toBeNull();
    expect(segmentsRemaining(project)).toBe(2);
  });

  it("does not count a render that failed or was canceled as done", () => {
    const project = {
      topics: [topic("a")],
      exports: [record({ id: "e1", status: "error", topicId: "a" })]
    };
    expect(nextSegmentToRender(project)?.id).toBe("a");
  });

  it("stops when every segment has a video", () => {
    const project = {
      topics: [topic("a")],
      exports: [record({ id: "e1", topicId: "a", file: "a.mp4" })]
    };
    expect(nextSegmentToRender(project)).toBeNull();
    expect(segmentsRemaining(project)).toBe(0);
  });
});
