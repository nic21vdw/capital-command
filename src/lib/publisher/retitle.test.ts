import { describe, expect, it } from "vitest";
import { collectRetitleTargets, matchClip, transcriptBetween, type ClipJob } from "@/lib/publisher/retitle";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * These pin the part that has to be right before a model is ever called: the
 * clip's own spoken words. Feed the titler the wrong window and it writes a
 * confident title for a moment that isn't in the clip.
 */

const CAPTIONS = [
  { start: 0, end: 2, text: "In just a couple weeks" },
  { start: 2, end: 4, text: "I'll be launching a software" },
  { start: 4, end: 6, text: "with almost no programming experience" },
  { start: 6, end: 8, text: "that I built entirely with AI" }
];

describe("transcriptBetween", () => {
  it("joins the captions inside the window", () => {
    expect(transcriptBetween(CAPTIONS, 2, 6)).toBe("I'll be launching a software with almost no programming experience");
  });

  // A clip rarely starts on a caption boundary; dropping the sentence it opens
  // mid-way through would hide what the clip is actually about.
  it("keeps a caption that only overlaps the window", () => {
    expect(transcriptBetween(CAPTIONS, 3, 5)).toBe("I'll be launching a software with almost no programming experience");
  });

  it("returns empty when nothing overlaps", () => {
    expect(transcriptBetween(CAPTIONS, 20, 30)).toBe("");
  });

  it("excludes a caption that merely touches the boundary", () => {
    expect(transcriptBetween(CAPTIONS, 4, 6)).toBe("with almost no programming experience");
  });
});

const JOB: ClipJob = {
  id: "job-1",
  fileName: "Building CoLateral Day 26",
  sourceCaptions: CAPTIONS,
  clips: [
    { id: "clip-7", start: 2, end: 6, file: "clip-07.mp4", downloadFile: "clip-07-ready.mp4" },
    { id: "clip-8", start: 6, end: 8, file: "clip-08.mp4" }
  ]
};

describe("matchClip", () => {
  it("matches the rendered file back to its clip", () => {
    expect(matchClip(JOB, "data\\clips\\outputs\\job-1\\clip-07-ready.mp4")?.id).toBe("clip-7");
  });

  it("matches the plain render too", () => {
    expect(matchClip(JOB, "data/clips/outputs/job-1/clip-08.mp4")?.id).toBe("clip-8");
  });

  it("returns null when nothing matches", () => {
    expect(matchClip(JOB, "data/clips/outputs/job-1/clip-99.mp4")).toBeNull();
  });
});

function item(id: string, jobId: string | undefined, clipPath: string): QueueItem {
  return {
    id,
    clipPath,
    title: "old title",
    caption: "caption",
    hashtags: [],
    publishAt: "2026-08-01T14:00:00.000Z",
    visibility: "public",
    createdAt: "2026-07-01T00:00:00.000Z",
    jobId,
    platforms: { youtube: { status: "scheduled", attempts: 0 } }
  };
}

describe("collectRetitleTargets", () => {
  it("pairs an item with its clip's spoken words", () => {
    const { targets, unresolved } = collectRetitleTargets([item("a", "job-1", "clip-07-ready.mp4")], [JOB]);
    expect(unresolved).toEqual([]);
    expect(targets[0].window).toEqual({ start: 2, end: 6, via: "clip" });
    expect(targets[0].transcript).toContain("launching a software");
  });

  // Clip Editor exports are named after the export, so the only link back to
  // the moment is the title the project handed to the queue.
  it("falls back to the editor project that carries the item's title", () => {
    const exported = item("a", "job-1", "export-export-456130a1.mp4");
    const { targets, unresolved } = collectRetitleTargets([exported], [JOB], [
      { id: "clip-1", jobId: "job-1", title: "old title", clipStart: 2, clipEnd: 6 }
    ]);
    expect(unresolved).toEqual([]);
    expect(targets[0].window).toEqual({ start: 2, end: 6, via: "project" });
    expect(targets[0].transcript).toContain("launching a software");
  });

  it("prefers a project from the same job when titles collide", () => {
    const exported = item("a", "job-1", "export-export-1.mp4");
    const { targets } = collectRetitleTargets([exported], [JOB], [
      { id: "other", jobId: "job-9", title: "old title", clipStart: 0, clipEnd: 2 },
      { id: "right", jobId: "job-1", title: "old title", clipStart: 4, clipEnd: 8 }
    ]);
    expect(targets[0].window.start).toBe(4);
  });

  it("uses the project's own captions when the source transcript misses the window", () => {
    const exported = item("a", "job-1", "export-export-2.mp4");
    const { targets } = collectRetitleTargets([exported], [JOB], [
      {
        id: "p",
        jobId: "job-1",
        title: "old title",
        clipStart: 900,
        clipEnd: 930,
        captions: [{ text: "burned in words" }, { text: "skipped", enabled: false }]
      }
    ]);
    expect(targets[0].transcript).toBe("burned in words");
  });

  // Every one of these keeps its existing title rather than getting a title
  // written from the wrong words — a bad title beats a confidently wrong one.
  it("reports an item whose job is missing", () => {
    const { targets, unresolved } = collectRetitleTargets([item("a", "gone", "clip-07-ready.mp4")], [JOB]);
    expect(targets).toEqual([]);
    expect(unresolved[0].reason).toContain("no clip job gone");
  });

  it("reports an item with no jobId at all", () => {
    const { unresolved } = collectRetitleTargets([item("a", undefined, "clip-07-ready.mp4")], [JOB]);
    expect(unresolved[0].reason).toContain("none recorded");
  });

  it("reports an item whose clip is in neither the job nor a project", () => {
    const { unresolved } = collectRetitleTargets([item("a", "job-1", "clip-99.mp4")], [JOB]);
    expect(unresolved[0].reason).toContain("nothing in job job-1 matches clip-99.mp4");
  });

  it("reports a clip window with no captions", () => {
    const job: ClipJob = { ...JOB, clips: [{ id: "c", start: 100, end: 120, file: "clip-01.mp4" }] };
    const { unresolved } = collectRetitleTargets([item("a", "job-1", "clip-01.mp4")], [job]);
    expect(unresolved[0].reason).toContain("no captions cover");
  });
});
