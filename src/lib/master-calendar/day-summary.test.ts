import { describe, expect, it } from "vitest";
import { buildDaySummary, summaryState } from "@/lib/master-calendar/day-summary";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";

const event = (over: Partial<MasterCalendarEvent>): MasterCalendarEvent => ({
  id: "shorts:q1",
  source: "shorts",
  dateKey: "2026-08-22",
  time: "12:00",
  title: "A short",
  platforms: ["YouTube"],
  status: "scheduled",
  ...over
});

describe("what a day adds up to", () => {
  it("counts only the day asked for", () => {
    const summary = buildDaySummary("2026-08-22", [event({}), event({ id: "shorts:q2", dateKey: "2026-08-23" })]);
    expect(summary.total).toBe(1);
  });

  it("reports the posting window and what has no time", () => {
    const summary = buildDaySummary("2026-08-22", [
      event({ id: "a", time: "20:00" }),
      event({ id: "b", time: "08:30" }),
      event({ id: "c", source: "fb", time: undefined, status: "draft", platforms: ["Facebook"] })
    ]);
    expect(summary.firstTime).toBe("08:30");
    expect(summary.lastTime).toBe("20:00");
    expect(summary.untimed).toBe(1);
  });

  it("counts a piece once per network it lands on", () => {
    const summary = buildDaySummary("2026-08-22", [
      event({ id: "a", platforms: ["YouTube", "TikTok", "Instagram"] }),
      event({ id: "b", platforms: ["YouTube"] })
    ]);
    expect(summary.platforms[0]).toEqual({ label: "YouTube", count: 2 });
    expect(summary.platforms.map((platform) => platform.label)).toContain("TikTok");
  });

  it("keeps sections in the calendar's own order, timed pieces first", () => {
    const summary = buildDaySummary("2026-08-22", [
      event({ id: "x1", source: "x", time: "09:00", status: "suggested", platforms: ["Threads"] }),
      event({ id: "s2", time: "18:00" }),
      event({ id: "s1", time: "07:00" })
    ]);
    expect(summary.sections.map((section) => section.source.id)).toEqual(["shorts", "x"]);
    expect(summary.sections[0].events.map((entry) => entry.time)).toEqual(["07:00", "18:00"]);
  });

  it("splits a failed upload out from the rest of the day", () => {
    const summary = buildDaySummary("2026-08-22", [
      event({ id: "a", status: "failed" }),
      event({ id: "b", status: "published" }),
      event({ id: "c", status: "queued" }),
      event({ id: "d", source: "fb", status: "draft", time: undefined })
    ]);
    expect(summary.states).toEqual({ failed: 1, published: 1, scheduled: 1, pending: 1 });
  });
});

describe("summaryState", () => {
  it("treats anything not yet committed to a time as still in progress", () => {
    expect(summaryState("posted")).toBe("published");
    expect(summaryState("uploaded")).toBe("scheduled");
    expect(summaryState("suggested")).toBe("pending");
    expect(summaryState("Editing")).toBe("pending");
    expect(summaryState("error")).toBe("failed");
  });
});
