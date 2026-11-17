import { describe, expect, it } from "vitest";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import { bookedClipFiles, groupPicks, readyFile, runBacklog, waitingClips } from "@/lib/pipeline/shortsBacklog";
import type { PipelineRun } from "@/lib/pipeline/types";
import { testItem } from "@/lib/publisher/test-helpers";
import type { QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-11-17T12:00:00.000Z");

function clip(id: string, score: number, files: Partial<ClipCandidate> = {}): ClipCandidate {
  return { id, start: 0, end: 30, score, breakdown: { hook: 0, pacing: 0, standalone: 0, intensity: 0 }, rationale: "", title: `Title ${id}`, ...files };
}

function job(id: string, clips: ClipCandidate[], status: ClipJob["status"] = "done"): ClipJob {
  return { id, fileName: id, sourceUrl: "https://example.test", status, stage: "finished", progress: 100, notices: [], createdAt: NOW.toISOString(), clips } as ClipJob;
}

function run(id: string, jobId: string, extra: Partial<PipelineRun> = {}): PipelineRun {
  return { id, name: `Stream - Day ${id}`, status: "running", notices: [], createdAt: "2026-11-12T10:00:00.000Z", clipJobId: jobId, ...extra } as PipelineRun;
}

function queued(id: string, clipPath: string, extra: Partial<QueueItem> = {}): QueueItem {
  return testItem({ id, clipPath, publishAt: "2026-11-20T15:00:00.000Z", ...extra });
}

describe("readyFile", () => {
  it("is the editor export, else the 9:16 render, never the 16:9 master", () => {
    expect(readyFile({ editedFile: "edit.mp4", downloadFile: "clip-01-ready.mp4" })).toBe("edit.mp4");
    expect(readyFile({ downloadFile: "clip-01-ready.mp4" })).toBe("clip-01-ready.mp4");
    expect(readyFile({})).toBeUndefined();
  });
});

describe("runBacklog", () => {
  it("counts only clips whose post-ready file exists, even while the job is still rendering", () => {
    const jobs = [job("j1", [clip("clip-1", 80, { downloadFile: "clip-01-ready.mp4" }), clip("clip-2", 70, { file: "clip-02.mp4" }), clip("clip-3", 60)], "processing")];
    const [entry] = runBacklog([run("r1", "j1")], jobs, [], NOW);
    expect(entry).toMatchObject({ ready: 1, booked: 0, decided: 0 });
    expect(entry.waiting.map((item) => item.candidateId)).toEqual(["clip:j1:clip-1"]);
  });

  it("leaves out a run whose job exists but has nothing finished, and a run with no job", () => {
    const jobs = [job("j1", [clip("clip-1", 80, { file: "clip-01.mp4" })], "processing")];
    expect(runBacklog([run("r1", "j1"), run("r2", "missing")], jobs, [], NOW)).toEqual([]);
  });

  it("is not satisfied by a carousel or the long-form edit of the same run", () => {
    const jobs = [job("j1", [clip("clip-1", 80, { downloadFile: "clip-01-ready.mp4" })])];
    const queue = [
      queued("deck", "data/carousel-images/a.png", { runId: "r1", mediaKind: "image", imagePaths: ["data/carousel-images/a.png"] }),
      queued("long", "data/longform/outputs/p1/edited.mp4", { runId: "r1", format: "long" })
    ];
    const [entry] = runBacklog([run("r1", "j1")], jobs, queue, NOW);
    expect(entry.waiting).toHaveLength(1);
  });

  it("reports a partly booked run by what is left, matching Windows and POSIX paths", () => {
    const jobs = [
      job("j1", [
        clip("clip-1", 90, { downloadFile: "clip-01-ready.mp4" }),
        clip("clip-2", 85, { downloadFile: "clip-02-ready.mp4", editedFile: "clip-02-edit.mp4" }),
        clip("clip-3", 40, { downloadFile: "clip-03-ready.mp4" })
      ])
    ];
    const queue = [
      queued("a", "data\\clips\\outputs\\j1\\clip-01-ready.mp4"),
      queued("b", "data/clips/outputs/j1/clip-02-edit.mp4", { jobId: "j1" })
    ];
    const [entry] = runBacklog([run("r1", "j1")], jobs, queue, NOW);
    expect(entry).toMatchObject({ ready: 3, booked: 2 });
    expect(entry.waiting.map((item) => item.clipId)).toEqual(["clip-3"]);
  });

  it("does not let the same file name in another job count as booked", () => {
    const jobs = [job("j1", [clip("clip-1", 90, { downloadFile: "clip-01-ready.mp4" })])];
    const queue = [queued("other", "data/clips/outputs/j2/clip-01-ready.mp4", { jobId: "j2" })];
    expect(runBacklog([run("r1", "j1")], jobs, queue, NOW)[0].waiting).toHaveLength(1);
  });

  it("respects clips he already decided about on a booking sheet", () => {
    const jobs = [job("j1", [clip("clip-1", 90, { downloadFile: "a.mp4" }), clip("clip-2", 80, { downloadFile: "b.mp4" }), clip("clip-3", 70, { downloadFile: "c.mp4" })])];
    const [entry] = runBacklog([run("r1", "j1", { queueHeldBack: ["clip:j1:clip-1"], queueBooked: ["clip:j1:clip-2"] })], jobs, [], NOW);
    expect(entry).toMatchObject({ ready: 3, booked: 0, decided: 2 });
    expect(entry.waiting.map((item) => item.clipId)).toEqual(["clip-3"]);
  });

  it("skips runs older than the lookback, drafts and marketing sources", () => {
    const jobs = [job("j1", [clip("clip-1", 90, { downloadFile: "a.mp4" })])];
    const runs = [
      run("old", "j1", { createdAt: "2026-10-01T10:00:00.000Z" }),
      run("draft", "j1", { status: "draft" }),
      run("mkt", "j1", { marketingSource: {} as PipelineRun["marketingSource"] })
    ];
    expect(runBacklog(runs, jobs, [], NOW)).toEqual([]);
  });
});

describe("waitingClips", () => {
  it("orders every waiting clip across streams by score, newer stream first on a tie", () => {
    const jobs = [
      job("j1", [clip("clip-1", 70, { downloadFile: "a.mp4" }), clip("clip-2", 90, { downloadFile: "b.mp4" })]),
      job("j2", [clip("clip-1", 70, { downloadFile: "a.mp4" })])
    ];
    const runs = [run("r1", "j1", { createdAt: "2026-11-10T10:00:00.000Z" }), run("r2", "j2", { createdAt: "2026-11-12T10:00:00.000Z" })];
    expect(waitingClips(runBacklog(runs, jobs, [], NOW)).map((item) => item.candidateId)).toEqual(["clip:j1:clip-2", "clip:j2:clip-1", "clip:j1:clip-1"]);
  });
});

describe("bookedClipFiles", () => {
  it("ignores image posts and long-form items", () => {
    const map = bookedClipFiles([
      queued("img", "data/clips/outputs/j1/a.png", { mediaKind: "image", jobId: "j1" }),
      queued("long", "data/clips/outputs/j1/b.mp4", { format: "long", jobId: "j1" })
    ]);
    expect(map.size).toBe(0);
  });
});

describe("groupPicks", () => {
  it("groups picks by run, drops repeats and returns what is no longer waiting as stale", () => {
    const jobs = [job("j1", [clip("clip-1", 90, { downloadFile: "a.mp4" }), clip("clip-2", 80, { downloadFile: "b.mp4" })]), job("j2", [clip("clip-1", 70, { downloadFile: "a.mp4" })])];
    const waiting = waitingClips(runBacklog([run("r1", "j1"), run("r2", "j2")], jobs, [], NOW));
    const { byRun, stale } = groupPicks(["clip:j1:clip-2", "clip:j2:clip-1", "clip:j1:clip-2", "clip:j9:clip-1"], waiting);
    expect(Object.fromEntries(byRun)).toEqual({ r1: ["clip:j1:clip-2"], r2: ["clip:j2:clip-1"] });
    expect(stale).toEqual(["clip:j9:clip-1"]);
  });
});
