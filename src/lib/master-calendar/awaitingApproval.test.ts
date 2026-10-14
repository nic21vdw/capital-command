import { describe, expect, it } from "vitest";
import { buildMasterCalendarEvents } from "@/lib/master-calendar/aggregate";
import { eventStatusLabel, isLateEventStatus } from "@/lib/master-calendar/types";
import { heldFrom, type ReviewPolicy } from "@/lib/publisher/approval";
import type { QueueItem } from "@/lib/publisher/types";
import { statusTone } from "@/lib/statusTone";
import type { AppData } from "@/types/domain";

const item = (over: Partial<QueueItem>): QueueItem =>
  ({
    id: "q1",
    clipPath: "data/clips/outputs/job1/clip-1.mp4",
    title: "A short",
    caption: "",
    hashtags: [],
    publishAt: "2026-08-08T15:30:00.000Z",
    visibility: "public",
    createdAt: "2026-08-07T00:00:00.000Z",
    platforms: { instagram: { status: "pending", attempts: 0 } },
    ...over
  }) as QueueItem;

const before = new Date("2026-08-07T12:00:00.000Z");
const after = new Date("2026-08-08T16:30:00.000Z");

const hold = (...channels: Array<keyof ReviewPolicy>): ReviewPolicy => ({
  youtube: "auto",
  instagram: "auto",
  tiktok: "auto",
  facebook: "auto",
  threads: "auto",
  ...Object.fromEntries(channels.map((channel) => [channel, "hold"]))
});

const events = (queueItems: QueueItem[], now: Date, policy?: ReviewPolicy) =>
  buildMasterCalendarEvents({
    data: { contentItems: [] } as unknown as AppData,
    queueItems,
    timeZone: "America/Toronto",
    startKey: "2026-08-08",
    days: 2,
    now,
    held: policy ? heldFrom(policy) : undefined
  });

describe("a post waiting on approval in the calendar", () => {
  it("reads awaiting approval, not overdue, once its slot has passed", () => {
    const [event] = events([item({})], after, hold("instagram"));
    expect(event.status).toBe("awaiting approval");
    expect(isLateEventStatus(event.status)).toBe(false);
    expect(eventStatusLabel(event.status, event)).toBe("Awaiting approval");
    expect(event.legs![0]).toMatchObject({ platform: "Instagram", awaitingApproval: true });
    expect(event.legs![0].late).toBeUndefined();
    expect(statusTone("awaiting approval")).toBe("warning");
  });

  it("reads awaiting approval before the slot too, instead of queued", () => {
    expect(events([item({})], before, hold("instagram"))[0].status).toBe("awaiting approval");
  });

  it("changes nothing under the default policy or with no policy at all", () => {
    expect(events([item({})], after)[0].status).toBe("overdue");
    expect(events([item({})], after, hold())[0].status).toBe("overdue");
    expect(events([item({})], before)[0].status).toBe("queued");
  });

  it("does not hide an overdue leg on a channel that is not held", () => {
    const mixed = item({ platforms: { instagram: { status: "pending", attempts: 0 }, tiktok: { status: "pending", attempts: 0 } } });
    const [event] = events([mixed], after, hold("instagram"));
    expect(event.status).toBe("overdue");
    expect(event.legs!.map((leg) => leg.late)).toEqual([undefined, "overdue"]);
  });

  it("lets go of a leg once someone has approved it", () => {
    const approved = item({ platforms: { instagram: { status: "pending", attempts: 0, approvedAt: "2026-08-08T10:00:00.000Z" } } });
    expect(events([approved], after, hold("instagram"))[0].status).toBe("overdue");
  });

  it("never claims a leg that is already on the platform", () => {
    const live = item({ platforms: { instagram: { status: "published", postId: "123", attempts: 1 } } });
    expect(events([live], after, hold("instagram"))[0].status).toBe("published");
  });
});
