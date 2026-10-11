import { describe, expect, it } from "vitest";
import { formatClockTime } from "@/lib/timeFormat";
import { openSlotsSummary, shouldCollapseOpenSlots } from "@/components/uploading-center/open-slots";

const at = (...times: string[]) => times.map((time) => ({ time }));

describe("shouldCollapseOpenSlots", () => {
  it("leaves a lone slot as its own row and folds two or more", () => {
    expect(shouldCollapseOpenSlots(0)).toBe(false);
    expect(shouldCollapseOpenSlots(1)).toBe(false);
    expect(shouldCollapseOpenSlots(2)).toBe(true);
    expect(shouldCollapseOpenSlots(6)).toBe(true);
  });
});

describe("openSlotsSummary", () => {
  it("counts the slots and names their times", () => {
    expect(openSlotsSummary(at("07:30", "10:00", "12:30"), formatClockTime)).toBe(
      "3 open slots - 7:30 AM, 10:00 AM, 12:30 PM"
    );
  });

  it("keeps the line short past three slots", () => {
    expect(openSlotsSummary(at("07:30", "10:00", "12:30", "15:00", "18:00", "21:00"), formatClockTime)).toBe(
      "6 open slots - 7:30 AM, 10:00 AM, 12:30 PM +3 more"
    );
  });

  it("reads singular and empty", () => {
    expect(openSlotsSummary(at("09:00"), formatClockTime)).toBe("1 open slot - 9:00 AM");
    expect(openSlotsSummary([], formatClockTime)).toBe("No open slots");
  });
});
