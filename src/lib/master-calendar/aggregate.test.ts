import { describe, expect, it } from "vitest";
import { buildMasterCalendarEvents } from "@/lib/master-calendar/aggregate";
import type { QueueItem } from "@/lib/publisher/types";
import type { AppData } from "@/types/domain";

const emptyData = { contentItems: [] } as unknown as AppData;

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
    platforms: { youtube: { status: "scheduled", attempts: 0 } },
    ...over
  }) as QueueItem;

const events = (queueItems: QueueItem[]) =>
  buildMasterCalendarEvents({
    data: emptyData,
    queueItems,
    timeZone: "America/Toronto",
    startKey: "2026-08-08",
    days: 2
  });

describe("what a booked queue item reads as on the calendar", () => {
  it("files a picture post under Carousels, not Shorts", () => {
    const [event] = events([
      item({
        id: "q2",
        clipPath: "data/carousels/deck-1/slide-01.jpg",
        mediaKind: "image",
        imagePaths: ["data/carousels/deck-1/slide-01.jpg", "data/carousels/deck-1/slide-02.jpg"],
        title: "What one stream produces",
        platforms: { instagram: { status: "scheduled", attempts: 0 } }
      } as Partial<QueueItem>)
    ]);
    expect(event.source).toBe("carousels");
    expect(event.id.startsWith("carousels:")).toBe(true);
  });

  it("leaves a video where it was", () => {
    const [event] = events([item({})]);
    expect(event.source).toBe("shorts");
  });
});
