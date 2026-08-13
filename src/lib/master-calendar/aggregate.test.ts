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
    expect(event.source).toBe("queued-carousels");
    expect(event.id.startsWith("queued-carousels:")).toBe(true);
    expect(event.href).toBe("/carousels?open=deck-1");
  });

  it("leaves a video where it was", () => {
    const [event] = events([item({})]);
    expect(event.source).toBe("shorts");
    expect(event.href).toBe("/uploading-center");
  });

  it("opens the clip's job when a short has one", () => {
    const [event] = events([item({ jobId: "job-9" })]);
    expect(event.href).toBe("/uploading-center?job=job-9");
  });
});

describe("carouselIdFromQueuePath", () => {
  it("reads the deck id out of a queued slide path", async () => {
    const { carouselIdFromQueuePath } = await import("@/lib/master-calendar/aggregate");
    expect(carouselIdFromQueuePath("data/carousels/carousel-abc/slide-01.jpg")).toBe("carousel-abc");
    expect(carouselIdFromQueuePath("C:\\data\\carousels\\carousel-abc\\slide-01.jpg")).toBe("carousel-abc");
  });
});
