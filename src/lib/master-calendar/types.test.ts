import { describe, expect, it } from "vitest";
import { eventStatusLabel, isReminderEventStatus } from "@/lib/master-calendar/types";

describe("reminder events", () => {
  it("tells a carousel reminder from a scheduled post and labels it plainly", () => {
    expect(isReminderEventStatus("reminder")).toBe(true);
    expect(isReminderEventStatus("scheduled")).toBe(false);
    expect(eventStatusLabel("reminder")).toBe("Reminder");
    expect(eventStatusLabel("scheduled")).toBe("scheduled");
  });
});
