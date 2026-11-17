import { describe, expect, it, vi } from "vitest";
import { NothingWaitingError } from "@/lib/pipeline/queueOutputs";
import type { RunBacklog } from "@/lib/pipeline/shortsBacklog";
import { bookShortsPicks, ReviewBusyError, shortsReviewState, skipShorts, type ReviewDeps } from "@/lib/pipeline/shortsReview";

function backlog(runId: string, clipIds: string[], score = 50): RunBacklog {
  return {
    runId, runName: `Vibe Coding - Day ${runId}`, createdAt: "2026-11-12T10:00:00.000Z", ready: clipIds.length, booked: 0, decided: 0,
    waiting: clipIds.map((clipId, i) => ({ candidateId: `clip:j${runId}:${clipId}`, runId, runName: `Day ${runId}`, jobId: `j${runId}`, clipId, title: clipId, score: score - i, durationSec: 30, file: `${clipId}.mp4` }))
  };
}

function deps(state: RunBacklog[], book?: ReviewDeps["book"]): ReviewDeps & { booked: string[][]; held: string[][] } {
  const booked: string[][] = [];
  const held: string[][] = [];
  return {
    booked,
    held,
    load: async () => ({ backlog: state, queue: [] }),
    book: book ?? (async (runId, ids) => {
      booked.push([runId, ...ids]);
      return { queued: ids.map((id) => ({ title: id, publishAt: "2026-11-19T15:00:00.000Z", platforms: ["youtube"] })), failed: [] };
    }),
    holdBack: async (runId, ids) => {
      held.push([runId, ...ids]);
    }
  };
}

describe("bookShortsPicks", () => {
  it("books only the picks, once per run, and books nothing he did not tick", async () => {
    const d = deps([backlog("97", ["a", "b", "c"]), backlog("98", ["x"])]);
    const outcome = await bookShortsPicks(["clip:j97:b", "clip:j98:x", "clip:j97:b"], d);
    expect(d.booked).toEqual([["97", "clip:j97:b"], ["98", "clip:j98:x"]]);
    expect(outcome.booked).toHaveLength(2);
    expect(outcome.stale).toEqual([]);
    expect(d.held).toEqual([]);
  });

  it("is a no-op when repeated after the clips were booked", async () => {
    const d = deps([backlog("97", ["a"])]);
    const outcome = await bookShortsPicks(["clip:j97:b"], d);
    expect(d.booked).toEqual([]);
    expect(outcome).toEqual({ booked: [], failed: [], stale: ["clip:j97:b"] });
  });

  it("reports a run that has nothing left to book as stale, and a failing run by name without stopping the rest", async () => {
    const d = deps([backlog("96", ["a"]), backlog("97", ["a"]), backlog("98", ["a"])], async (runId, ids) => {
      if (runId === "96") throw new NothingWaitingError();
      if (runId === "97") throw new Error("Video and picture posting is switched off.");
      return { queued: [], failed: ids.map((id) => ({ title: id, error: "Every slot in the next 3 months is taken" })) };
    });
    const outcome = await bookShortsPicks(["clip:j96:a", "clip:j97:a", "clip:j98:a"], d);
    expect(outcome.stale).toEqual(["clip:j96:a"]);
    expect(outcome.failed).toEqual([
      { runId: "97", title: "Day 97", error: "Video and picture posting is switched off." },
      { runId: "98", title: "clip:j98:a", error: "Every slot in the next 3 months is taken" }
    ]);
  });

  it("refuses a second booking while one is running, then takes the next one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const d = deps([backlog("97", ["a"])], async () => {
      await gate;
      return { queued: [], failed: [] };
    });
    const first = bookShortsPicks(["clip:j97:a"], d);
    await expect(bookShortsPicks(["clip:j97:a"], d)).rejects.toBeInstanceOf(ReviewBusyError);
    await expect(skipShorts(["clip:j97:a"], d)).rejects.toBeInstanceOf(ReviewBusyError);
    release();
    await first;
    await expect(bookShortsPicks(["clip:j97:a"], d)).resolves.toMatchObject({ stale: [] });
  });

  it("frees the lock when the queue cannot be read", async () => {
    const d = deps([]);
    d.load = vi.fn().mockRejectedValueOnce(new Error("queue unreadable")).mockResolvedValue({ backlog: [], queue: [] });
    await expect(bookShortsPicks(["clip:j97:a"], d)).rejects.toThrow("queue unreadable");
    await expect(bookShortsPicks(["clip:j97:a"], d)).resolves.toEqual({ booked: [], failed: [], stale: ["clip:j97:a"] });
  });
});

describe("skipShorts", () => {
  it("holds back only clips that are still waiting", async () => {
    const d = deps([backlog("97", ["a", "b"])]);
    expect(await skipShorts(["clip:j97:a", "clip:j97:z"], d)).toEqual({ skipped: 1, stale: ["clip:j97:z"] });
    expect(d.held).toEqual([["97", "clip:j97:a"]]);
    expect(d.booked).toEqual([]);
  });
});

describe("shortsReviewState", () => {
  it("lists every waiting clip best first with its stream's short name and per-stream counts", async () => {
    const state = await shortsReviewState(new Date("2026-11-17T12:00:00.000Z"), deps([backlog("97", ["a", "b"], 60), backlog("98", ["x"], 90)]));
    expect(state.clips.map((clip) => [clip.candidateId, clip.stream])).toEqual([["clip:j98:x", "Day 98"], ["clip:j97:a", "Day 97"], ["clip:j97:b", "Day 97"]]);
    expect(state.streams).toEqual([
      { runId: "97", name: "Day 97", ready: 2, booked: 0, decided: 0, waiting: 2 },
      { runId: "98", name: "Day 98", ready: 1, booked: 0, decided: 0, waiting: 1 }
    ]);
    expect(state.observedAt).toBe("2026-11-17T12:00:00.000Z");
  });
});
