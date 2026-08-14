import { describe, expect, it } from "vitest";
import { indexQueueByClip, type ClipFileRef } from "@/lib/publisher/clipQueueIndex";
import type { QueueItem } from "@/lib/publisher/types";

function item(id: string, clipPath: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    title: id,
    clipPath,
    publishAt: "2026-03-05T12:30:00.000Z",
    createdAt: "2026-03-04T12:00:00.000Z",
    platforms: { youtube: { status: "pending" } },
    ...overrides
  } as QueueItem;
}

function clip(key: string, jobId: string, files: string[]): ClipFileRef {
  return { key, jobId, allFiles: files };
}

/** The scan this index replaces, kept as the definition of "right". */
function matchesByScan(items: QueueItem[], ref: ClipFileRef): QueueItem[] {
  return items.filter((entry) =>
    [entry.clipPath, entry.sourceClipPath].some((candidate) => {
      if (!candidate) return false;
      const normalized = candidate.replace(/\\/g, "/");
      return ref.allFiles.some(
        (file) =>
          normalized.endsWith(`/${ref.jobId}/${file}`) ||
          (entry.jobId === ref.jobId && normalized.endsWith(`/${file}`))
      );
    })
  );
}

describe("indexQueueByClip", () => {
  it("finds a clip's posts by the job folder in the path", () => {
    const items = [item("a", "data/clips/outputs/job1/clip-1.mp4"), item("b", "data/clips/outputs/job2/clip-1.mp4")];
    const index = indexQueueByClip(items, [clip("job1/clip-1.mp4", "job1", ["clip-1.mp4"])]);
    expect(index.get("job1/clip-1.mp4")?.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("matches a bare file name only when the item names the same job", () => {
    const items = [
      item("mine", "uploads/clip-1.mp4", { jobId: "job1" }),
      item("theirs", "uploads/clip-1.mp4", { jobId: "job2" })
    ];
    const index = indexQueueByClip(items, [clip("job1/clip-1.mp4", "job1", ["clip-1.mp4"])]);
    expect(index.get("job1/clip-1.mp4")?.map((entry) => entry.id)).toEqual(["mine"]);
  });

  it("matches the file a vertical re-render was derived from", () => {
    const items = [
      item("v", "data/clips/outputs/job1/clip-1-vertical.mp4", {
        sourceClipPath: "data\\clips\\outputs\\job1\\clip-1.mp4"
      })
    ];
    const index = indexQueueByClip(items, [clip("job1/clip-1.mp4", "job1", ["clip-1.mp4"])]);
    expect(index.get("job1/clip-1.mp4")?.map((entry) => entry.id)).toEqual(["v"]);
  });

  it("lists a clip's posts once each, in queue order", () => {
    const items = [
      item("second", "data/clips/outputs/job1/clip-1.mp4", { sourceClipPath: "data/clips/outputs/job1/clip-1.mp4" }),
      item("first", "data/clips/outputs/job1/edited-1.mp4", { jobId: "job1" })
    ];
    const index = indexQueueByClip(items, [clip("job1/clip-1.mp4", "job1", ["edited-1.mp4", "clip-1.mp4"])]);
    expect(index.get("job1/clip-1.mp4")?.map((entry) => entry.id)).toEqual(["second", "first"]);
  });

  it("leaves a clip with nothing booked out of the index", () => {
    const index = indexQueueByClip([item("a", "data/clips/outputs/job1/clip-1.mp4")], [
      clip("job1/clip-9.mp4", "job1", ["clip-9.mp4"])
    ]);
    expect(index.get("job1/clip-9.mp4")).toBeUndefined();
  });

  /**
   * The shape that made the Uploading Center unusable: a run of clips, a real
   * queue, and one full scan of the queue per clip per render. Sized like the
   * live app (500 posts, 250 clips across 25 runs, four files per clip) and
   * held to a bound a fresh scan per clip cannot meet.
   */
  it("indexes a real-sized queue once instead of scanning it per clip", () => {
    const jobs = Array.from({ length: 25 }, (_, index) => `job${index}`);
    const clips: ClipFileRef[] = [];
    for (const jobId of jobs) {
      for (let n = 0; n < 10; n += 1) {
        clips.push(
          clip(`${jobId}/clip-${n}.mp4`, jobId, [
            `edited-${n}.mp4`,
            `download-${n}.mp4`,
            `clip-${n}.mp4`,
            `clip-${n}-vertical.mp4`
          ])
        );
      }
    }
    const items = Array.from({ length: 500 }, (_, index) => {
      const jobId = jobs[index % jobs.length];
      const n = index % 10;
      return item(`item-${index}`, `data/clips/outputs/${jobId}/clip-${n}.mp4`, { jobId });
    });
    expect(clips).toHaveLength(250);

    const started = performance.now();
    const index = indexQueueByClip(items, clips);
    const elapsed = performance.now() - started;

    for (const ref of clips) {
      expect(index.get(ref.key) ?? []).toEqual(matchesByScan(items, ref));
    }
    // A scan per clip is 250 x 500 x 4 comparisons and measures in the hundreds
    // of milliseconds; the index is one pass over each list.
    expect(elapsed).toBeLessThan(50);
  });

  it("answers every lookup without touching the queue again", () => {
    const items = Array.from({ length: 400 }, (_, index) =>
      item(`item-${index}`, `data/clips/outputs/job1/clip-${index % 20}.mp4`, { jobId: "job1" })
    );
    let reads = 0;
    const counted = new Proxy(items, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver);
      }
    });
    const clips = Array.from({ length: 20 }, (_, n) => clip(`job1/clip-${n}.mp4`, "job1", [`clip-${n}.mp4`]));
    const index = indexQueueByClip(counted, clips);
    const afterBuild = reads;
    for (const ref of clips) index.get(ref.key);
    // Every item is read while the index is built; the lookups read none.
    expect(afterBuild).toBeLessThanOrEqual(items.length);
    expect(reads).toBe(afterBuild);
  });
});
