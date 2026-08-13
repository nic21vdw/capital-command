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

  it("opens that queued short, not a job dropdown", () => {
    const [event] = events([item({})]);
    expect(event.source).toBe("shorts");
    expect(event.href).toBe("/uploading-center?item=q1&platform=youtube");
  });

  it("still names the short when it came from a clip job", () => {
    const [event] = events([item({ jobId: "job-9" })]);
    expect(event.href).toBe("/uploading-center?item=q1&platform=youtube");
  });
});

describe("sourceHrefForDay", () => {
  it("pages the uploading center to that calendar day", async () => {
    const { sourceHrefForDay } = await import("@/lib/master-calendar/aggregate");
    expect(sourceHrefForDay("shorts", "2026-08-14")).toBe("/uploading-center?day=2026-08-14");
    expect(sourceHrefForDay("x", "2026-08-14")).toBe("/x-posts?date=2026-08-14");
    expect(sourceHrefForDay("queued-carousels", "2026-08-14")).toBe("/carousels");
  });
});

describe("carouselIdFromQueuePath", () => {
  it("reads the deck id out of a queued slide path", async () => {
    const { carouselIdFromQueuePath } = await import("@/lib/master-calendar/aggregate");
    expect(carouselIdFromQueuePath("data/carousels/carousel-abc/slide-01.jpg")).toBe("carousel-abc");
    expect(carouselIdFromQueuePath("C:\\data\\carousels\\carousel-abc\\slide-01.jpg")).toBe("carousel-abc");
  });
});
