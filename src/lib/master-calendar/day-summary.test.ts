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
    expect(summary.states).toEqual({ failed: 1, published: 1, scheduled: 1, shouldBeLive: 0, overdue: 0, needsConnection: 0, skipped: 0, pending: 1 });
  });
});

describe("a post past its slot", () => {
  it("is neither scheduled nor 'still to go': it has its own count, in the day and in its section", () => {
    const summary = buildDaySummary("2026-08-22", [
      event({ id: "a", status: "should be live" }),
      event({ id: "b", status: "overdue", platforms: ["Instagram"] }),
      event({ id: "c", status: "scheduled" })
    ]);
    expect(summary.states).toMatchObject({ scheduled: 1, shouldBeLive: 1, overdue: 1, failed: 0 });
    expect(summary.sections[0].states).toMatchObject({ scheduled: 1, shouldBeLive: 1, overdue: 1 });
  });

  it("counts a post waiting on a connection on its own, not as overdue", () => {
    const summary = buildDaySummary("2026-08-22", [event({ id: "a", status: "needs connection" }), event({ id: "b", status: "overdue" })]);
    expect(summary.states).toMatchObject({ needsConnection: 1, overdue: 1, scheduled: 0 });
    expect(summaryState("Needs connection")).toBe("needsConnection");
  });

  it("flags a post still ahead of its slot on an unconnected account the same way, not as scheduled", () => {
    expect(summaryState("awaiting connection")).toBe("needsConnection");
    const summary = buildDaySummary("2026-08-22", [event({ id: "a", status: "awaiting connection" }), event({ id: "b", status: "queued" })]);
    expect(summary.states).toMatchObject({ needsConnection: 1, scheduled: 1, overdue: 0 });
  });

  it("reads the stored status case-insensitively", () => {
    expect(summaryState("Should be live")).toBe("shouldBeLive");
    expect(summaryState("overdue")).toBe("overdue");
  });
});

describe("the by-hand to-dos", () => {
  it("lists every manual leg with its card, in clock order", () => {
    const summary = buildDaySummary("2026-08-22", [
      event({
        id: "late",
        time: "18:00",
        title: "Evening clip",
        manual: [{ platform: "TikTok", href: "/uploading-center?item=q2&platform=tiktok" }]
      }),
      event({
        id: "early",
        time: "07:00",
        title: "Deck",
        manual: [
          { platform: "Instagram", href: "/uploading-center?item=q1&platform=instagram", fileUrl: "/api/publish/q1/images/0" },
          { platform: "Facebook", href: "/uploading-center?item=q1&platform=facebook", fileUrl: "/api/publish/q1/images/0" }
        ]
      }),
      event({ id: "auto", time: "12:00" })
    ]);
    expect(summary.todos.map((todo) => `${todo.time} ${todo.platform}`)).toEqual([
      "07:00 Instagram",
      "07:00 Facebook",
      "18:00 TikTok"
    ]);
    expect(summary.todos[0].fileUrl).toBe("/api/publish/q1/images/0");
    expect(summary.todos[2].fileUrl).toBeUndefined();
  });

  it("is empty when nothing needs a hand", () => {
    expect(buildDaySummary("2026-08-22", [event({ id: "a" })]).todos).toEqual([]);
  });
});

describe("summaryState", () => {
  it("counts a partly failed post as failed and a skipped slot as neither done nor pending", () => {
    expect(summaryState("partly failed")).toBe("failed");
    expect(summaryState("skipped")).toBe("skipped");
    expect(summaryState("planned")).toBe("pending");
  });

  it("treats anything not yet committed to a time as still in progress", () => {
    expect(summaryState("posted")).toBe("published");
    expect(summaryState("uploaded")).toBe("scheduled");
    expect(summaryState("suggested")).toBe("pending");
    expect(summaryState("Editing")).toBe("pending");
    expect(summaryState("error")).toBe("failed");
  });
});
