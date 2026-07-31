import { describe, expect, it } from "vitest";
import {
  editableTarget,
  movedToDay,
  nudgedBy,
  rescheduleRequest,
  rewriteRequest,
  skipRequest
} from "@/lib/master-calendar/editing";
import { mergeThreadsEvents } from "@/lib/master-calendar/aggregate";
import type { CalendarEditTarget, MasterCalendarEvent } from "@/lib/master-calendar/types";

const TZ = "America/Toronto";

function event(overrides: Partial<MasterCalendarEvent> = {}): MasterCalendarEvent {
  return {
    id: "shorts:q1",
    source: "shorts",
    dateKey: "2026-07-30",
    time: "19:30",
    title: "A clip",
    platforms: ["YouTube"],
    status: "queued",
    edit: { kind: "queue", id: "q1", publishAt: "2026-07-30T23:30:00.000Z", text: "caption" },
    ...overrides
  };
}

describe("editableTarget", () => {
  it("is null for an event no system here can rewrite", () => {
    expect(editableTarget(event({ edit: undefined, source: "carousels" }))).toBeNull();
  });

  it("is null once the post has left the app", () => {
    const locked = event({
      edit: { kind: "queue", id: "q1", publishAt: "x", text: "", lockedReason: "Already on YouTube" }
    });
    expect(editableTarget(locked)).toBeNull();
  });

  it("is the target for a post still waiting", () => {
    expect(editableTarget(event())?.id).toBe("q1");
  });
});

describe("movedToDay", () => {
  it("carries the wall-clock time to the new day", () => {
    // 19:30 Toronto on Aug 3 is 23:30Z (EDT, UTC-4).
    expect(movedToDay(event(), "2026-08-03", TZ)).toBe("2026-08-03T23:30:00.000Z");
  });

  it("keeps the wall-clock time across a DST boundary rather than the elapsed time", () => {
    // Nov 1 2026 is the fall-back; 19:30 Toronto is then 00:30Z the next day.
    expect(movedToDay(event(), "2026-11-05", TZ)).toBe("2026-11-06T00:30:00.000Z");
  });

  it("does nothing when dropped on the day it already sits on", () => {
    expect(movedToDay(event(), "2026-07-30", TZ)).toBeNull();
  });

  it("refuses a locked event and a malformed day", () => {
    const locked = event({ edit: { kind: "queue", id: "q1", publishAt: "x", text: "", lockedReason: "no" } });
    expect(movedToDay(locked, "2026-08-03", TZ)).toBeNull();
    expect(movedToDay(event(), "not-a-day", TZ)).toBeNull();
  });

  it("treats a day-level event with no time as midnight", () => {
    expect(movedToDay(event({ time: undefined }), "2026-08-03", TZ)).toBe("2026-08-03T04:00:00.000Z");
  });
});

describe("nudgedBy", () => {
  it("moves the stored instant, forwards and back", () => {
    expect(nudgedBy(event(), 60)).toBe("2026-07-31T00:30:00.000Z");
    expect(nudgedBy(event(), -90)).toBe("2026-07-30T22:00:00.000Z");
  });

  it("is null for a zero nudge or a locked event", () => {
    expect(nudgedBy(event(), 0)).toBeNull();
    const locked = event({ edit: { kind: "queue", id: "q1", publishAt: "x", text: "", lockedReason: "no" } });
    expect(nudgedBy(locked, 60)).toBeNull();
  });
});

describe("write requests", () => {
  const queue: CalendarEditTarget = { kind: "queue", id: "q1", publishAt: "x", text: "" };
  const threads: CalendarEditTarget = { kind: "threads", id: "t1", publishAt: "x", text: "" };

  it("routes a queue post through the publish API", () => {
    expect(rescheduleRequest(queue, "2026-08-01T12:00:00.000Z")).toEqual({
      url: "/api/publish/q1",
      method: "PATCH",
      body: { publishAt: "2026-08-01T12:00:00.000Z" }
    });
    expect(rewriteRequest(queue, "new")).toEqual({
      url: "/api/publish/q1",
      method: "PATCH",
      body: { caption: "new" }
    });
    expect(skipRequest(queue)).toEqual({ url: "/api/publish/q1/skip", method: "POST", body: {} });
  });

  it("routes a Threads post through the autopilot API", () => {
    expect(rescheduleRequest(threads, "2026-08-01T12:00:00.000Z")).toEqual({
      url: "/api/threads",
      method: "POST",
      body: { action: "reschedule", id: "t1", at: "2026-08-01T12:00:00.000Z" }
    });
    expect(rewriteRequest(threads, "new")).toEqual({
      url: "/api/threads",
      method: "POST",
      body: { action: "edit", id: "t1", text: "new" }
    });
    expect(skipRequest(threads)).toEqual({
      url: "/api/threads",
      method: "POST",
      body: { action: "skip", id: "t1" }
    });
  });
});

describe("mergeThreadsEvents", () => {
  const pack = (dateKey: string, id: string): MasterCalendarEvent => ({
    id,
    source: "x",
    dateKey,
    title: "pack",
    platforms: ["X", "Threads"],
    status: "suggested"
  });

  it("lets the real queue supersede the suggested pack on days it has scheduled", () => {
    const queued: MasterCalendarEvent = {
      id: "threads:t1",
      source: "x",
      dateKey: "2026-07-30",
      title: "real",
      platforms: ["Threads"],
      status: "pending"
    };
    const merged = mergeThreadsEvents([pack("2026-07-30", "x:1"), pack("2026-07-31", "x:2")], [queued]);
    expect(merged.map((item) => item.id)).toEqual(["threads:t1", "x:2"]);
  });

  it("keeps the pack untouched where the queue has not reached", () => {
    expect(mergeThreadsEvents([pack("2026-08-02", "x:1")], [])).toHaveLength(1);
  });
});
