import { describe, expect, it } from "vitest";
import { eventStatusLabel, isAwaitingConnectionEventStatus, isLateEventStatus, isReminderEventStatus } from "@/lib/master-calendar/types";

describe("reminder events", () => {
  it("tells a carousel reminder from a scheduled post and labels it plainly", () => {
    expect(isReminderEventStatus("reminder")).toBe(true);
    expect(isReminderEventStatus("scheduled")).toBe(false);
    expect(eventStatusLabel("reminder")).toBe("Reminder");
    expect(eventStatusLabel("scheduled")).toBe("scheduled");
  });
});

describe("past-slot statuses", () => {
  it("labels them plainly and tells them from scheduled and failed", () => {
    expect(eventStatusLabel("should be live")).toBe("Should be live");
    expect(eventStatusLabel("overdue")).toBe("Overdue");
    expect(isLateEventStatus("should be live")).toBe(true);
    expect(isLateEventStatus("Overdue")).toBe(true);
    expect(isLateEventStatus("needs connection")).toBe(true);
    expect(eventStatusLabel("needs connection")).toBe("Needs connection");
    expect(eventStatusLabel("needs connection", { legs: [{ platform: "YouTube", status: "pending", late: "needs-connection" }] })).toBe("Needs YouTube connection");
    expect(isLateEventStatus("scheduled")).toBe(false);
    expect(isLateEventStatus("failed")).toBe(false);
  });
});

describe("awaiting-connection status", () => {
  it("reads as the Uploading Center does before the slot, and is not late", () => {
    expect(isAwaitingConnectionEventStatus("awaiting connection")).toBe(true);
    expect(isLateEventStatus("awaiting connection")).toBe(false);
    expect(eventStatusLabel("awaiting connection")).toBe("Needs connection");
    expect(
      eventStatusLabel("awaiting connection", { legs: [{ platform: "YouTube", status: "pending", awaitingConnection: true }] })
    ).toBe("Needs YouTube connection");
  });
});

describe("the word for a booked post that has not gone out", () => {
  it("is Scheduled whether the source calls it queued or scheduled", () => {
    expect(eventStatusLabel("queued")).toBe("Scheduled");
    expect(eventStatusLabel("Queued")).toBe("Scheduled");
    expect(eventStatusLabel("published")).toBe("published");
  });
});
