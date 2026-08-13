import { describe, expect, it } from "vitest";
import { deliveryByRun } from "@/lib/pipeline/delivery";
import type { PlatformStatus, QueueItem } from "@/lib/publisher/types";

const item = (over: Partial<QueueItem> & { statuses?: PlatformStatus[] }): QueueItem =>
  ({
    id: over.id ?? "q1",
    clipPath: "data/clips/a.mp4",
    title: "A clip",
    caption: "",
    hashtags: [],
    publishAt: over.publishAt ?? "2026-08-20T13:00:00.000Z",
    visibility: "public",
    createdAt: "2026-08-12T12:00:00.000Z",
    runId: over.runId,
    jobId: over.jobId,
    platforms: Object.fromEntries(
      (over.statuses ?? ["pending"]).map((status, index) => [
        ["youtube", "instagram", "tiktok", "facebook"][index],
        { status, attempts: 0 }
      ])
    )
  }) as QueueItem;

const now = new Date("2026-08-12T18:00:00.000Z");

describe("how much of a run actually went out", () => {
  it("counts a post as posted the moment one platform is live", () => {
    const delivery = deliveryByRun([item({ runId: "r1", statuses: ["published", "failed"] })], new Map(), now);
    expect(delivery.get("r1")).toMatchObject({ booked: 1, posted: 1, failed: 0, uploading: 0 });
  });

  it("separates bytes accepted from bytes live", () => {
    const delivery = deliveryByRun([item({ runId: "r1", statuses: ["scheduled"] })], new Map(), now);
    expect(delivery.get("r1")).toMatchObject({ booked: 1, posted: 0, uploading: 1 });
  });

  it("only calls a post failed when every platform gave up", () => {
    const delivery = deliveryByRun(
      [
        item({ id: "a", runId: "r1", statuses: ["failed", "failed"] }),
        item({ id: "b", runId: "r1", statuses: ["failed", "pending"] })
      ],
      new Map(),
      now
    );
    expect(delivery.get("r1")).toMatchObject({ booked: 2, failed: 1 });
  });

  // Everything booked before runId existed carries only the clip job, and a run
  // whose shorts all read as unscheduled is the sentence this exists to avoid.
  it("still finds older posts through the clip job", () => {
    const delivery = deliveryByRun([item({ jobId: "job-9" })], new Map([["job-9", "r1"]]), now);
    expect(delivery.get("r1")?.booked).toBe(1);
  });

  it("ignores posts from anywhere else", () => {
    expect(deliveryByRun([item({})], new Map(), now).size).toBe(0);
  });

  it("reports the next slot still to come, not one already gone", () => {
    const delivery = deliveryByRun(
      [
        item({ id: "a", runId: "r1", publishAt: "2026-08-11T13:00:00.000Z" }),
        item({ id: "b", runId: "r1", publishAt: "2026-08-25T13:00:00.000Z" }),
        item({ id: "c", runId: "r1", publishAt: "2026-08-20T13:00:00.000Z" })
      ],
      new Map(),
      now
    );
    expect(delivery.get("r1")?.nextAt).toBe("2026-08-20T13:00:00.000Z");
  });
});
