import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publisher/config", () => ({ publisherConfig: () => ({ enabled: false, timezone: "America/Toronto" }) }));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: vi.fn(() => { throw new Error("Disabled publisher must not read its queue."); }) }));
vi.mock("@/lib/storage/store", () => ({ readAppData: vi.fn(async () => ({})) }));
vi.mock("@/lib/master-calendar/aggregate", () => ({
  todayKeyIn: () => "2026-10-02",
  buildMasterCalendarEvents: vi.fn(() => [])
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
