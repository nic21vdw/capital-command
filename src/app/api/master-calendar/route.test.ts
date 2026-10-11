import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publisher/config", () => ({ publisherConfig: () => ({ enabled: false, timezone: "America/Toronto" }) }));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: vi.fn(() => { throw new Error("Disabled publisher must not read its queue."); }) }));
vi.mock("@/lib/storage/store", () => ({ readAppData: vi.fn(async () => ({})) }));
vi.mock("@/lib/master-calendar/aggregate", () => ({
  todayKeyIn: () => "2026-10-02",
  buildMasterCalendarEvents: vi.fn(() => [])
}));

vi.mock("@/lib/publisher/youtubeStats", () => ({
  liveStatsDeps: {
    readCache: vi.fn(async () => ({
      vid1: { views: 10, likes: 2, comments: 0, fetchedAt: "2026-10-01T00:00:00.000Z" },
      other: { views: 99, likes: 9, comments: 0, fetchedAt: "2026-10-01T00:00:00.000Z" }
    }))
  }
}));

import { GET } from "./route";
import { buildMasterCalendarEvents } from "@/lib/master-calendar/aggregate";

afterEach(() => vi.clearAllMocks());

describe("calendar request windows", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-00-01", "not-a-date"])("defaults impossible start %s to today", async (start) => {
    const response = await GET(new NextRequest(`http://localhost/api/master-calendar?start=${start}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ start: "2026-10-02", days: 42, publishEnabled: false });
  });

  it("keeps a valid leap day and at least one day for fractional requests", async () => {
    const response = await GET(new NextRequest("http://localhost/api/master-calendar?start=2028-02-29&days=0.5"));
    expect(await response.json()).toMatchObject({ start: "2028-02-29", days: 1 });
    expect(buildMasterCalendarEvents).toHaveBeenCalledWith(expect.objectContaining({ startKey: "2028-02-29", days: 1 }));
  });

  it("caps large windows while retaining a requested historical start", async () => {
    const response = await GET(new NextRequest("http://localhost/api/master-calendar?start=2025-12-31&days=50000"));
    expect(await response.json()).toMatchObject({ start: "2025-12-31", days: 62 });
  });
});

describe("cached YouTube numbers", () => {
  it("ride along for the videos in the window, read from disk only", async () => {
    vi.mocked(buildMasterCalendarEvents).mockReturnValueOnce([
      { id: "shorts:q1", source: "shorts", dateKey: "2026-10-01", title: "t", platforms: ["YouTube"], status: "published", youtube: { itemId: "q1", videoId: "vid1" } },
      { id: "shorts:q2", source: "shorts", dateKey: "2026-10-01", title: "u", platforms: ["YouTube"], status: "published", youtube: { itemId: "q2", videoId: "never-cached" } }
    ]);
    const body = await (await GET(new NextRequest("http://localhost/api/master-calendar?start=2026-10-01&days=1"))).json();
    expect(Object.keys(body.youtubeStats)).toEqual(["vid1"]);
    expect(body.youtubeStats.vid1.views).toBe(10);
  });

  it("is an empty object when no event has a video", async () => {
    const body = await (await GET(new NextRequest("http://localhost/api/master-calendar?start=2026-10-01&days=1"))).json();
    expect(body.youtubeStats).toEqual({});
  });
});
