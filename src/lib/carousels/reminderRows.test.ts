import { describe, expect, it } from "vitest";
import { weeklyReminderRows } from "@/lib/carousels/reminderRows";
import type { Carousel, CarouselSchedule } from "@/types/domain";

function schedule(id: string, patch: Partial<CarouselSchedule>): CarouselSchedule {
  return {
    id,
    platforms: ["tiktok", "youtube"],
    time: "18:00",
    recurrence: "weekly",
    date: "2026-10-13",
    weekday: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...patch
  };
}

function carousel(id: string, title: string, schedules: CarouselSchedule[]): Carousel {
  return { id, title, schedules, createdAt: "2026-10-01T00:00:00.000Z" } as unknown as Carousel;
}

describe("weeklyReminderRows", () => {
  it("folds a weekly reminder repeated on several dates into one row", () => {
    const rows = weeklyReminderRows([carousel("c1", "How I ship", [schedule("s1", {})])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ carouselId: "c1", weekday: 2, time: "18:00", scheduleIds: ["s1"] });
    expect(rows[0].label).toBe("Every Tue 6:00 PM · TikTok, YouTube");
  });

  it("lists networks in the platform order, once each, across schedules on the same slot", () => {
    const rows = weeklyReminderRows([
      carousel("c1", "How I ship", [
        schedule("s1", { platforms: ["youtube"] }),
        schedule("s2", { platforms: ["instagram", "tiktok"] })
      ])
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].platforms).toEqual(["instagram", "tiktok", "youtube"]);
    expect(rows[0].label).toBe("Every Tue 6:00 PM · Instagram, TikTok, YouTube");
    expect(rows[0].scheduleIds).toEqual(["s1", "s2"]);
  });

  it("keeps different weekdays, times and carousels as separate rows", () => {
    const rows = weeklyReminderRows([
      carousel("c1", "A", [schedule("s1", {}), schedule("s2", { weekday: 4 }), schedule("s3", { time: "09:30" })]),
      carousel("c2", "B", [schedule("s4", {})])
    ]);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.key)).size).toBe(4);
  });

  it("falls back to the anchor date's weekday when none is stored", () => {
    // 2026-10-13 is a Tuesday.
    const rows = weeklyReminderRows([carousel("c1", "A", [schedule("s1", { weekday: undefined })])]);
    expect(rows[0].weekday).toBe(2);
  });

  it("leaves daily and one-off reminders out", () => {
    const rows = weeklyReminderRows([
      carousel("c1", "A", [schedule("s1", { recurrence: "daily" }), schedule("s2", { recurrence: "once" })])
    ]);
    expect(rows).toEqual([]);
  });

  it("orders rows Monday first, then by time", () => {
    const rows = weeklyReminderRows([
      carousel("c1", "A", [schedule("sun", { weekday: 0 }), schedule("tue-late", { time: "20:00" }), schedule("mon", { weekday: 1 }), schedule("tue", {})])
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "Every Mon 6:00 PM · TikTok, YouTube",
      "Every Tue 6:00 PM · TikTok, YouTube",
      "Every Tue 8:00 PM · TikTok, YouTube",
      "Every Sun 6:00 PM · TikTok, YouTube"
    ]);
  });
});
