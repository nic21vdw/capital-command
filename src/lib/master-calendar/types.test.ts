import { describe, expect, it } from "vitest";
import { eventStatusLabel, isLateEventStatus, isReminderEventStatus } from "@/lib/master-calendar/types";

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
