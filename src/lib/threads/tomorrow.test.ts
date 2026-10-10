import { describe, expect, it } from "vitest";
import { nextDayKey, tomorrowReady } from "@/lib/threads/tomorrow";

const row = (batchDate: string, slot: number, origin?: "pipeline") => ({ batchDate, slot, ...(origin ? { origin } : {}) });

describe("tomorrow's Threads batch", () => {
  it("steps over month and year ends without a time zone", () => {
    expect(nextDayKey("2026-10-10")).toBe("2026-10-11");
    expect(nextDayKey("2026-10-31")).toBe("2026-11-01");
    expect(nextDayKey("2026-12-31")).toBe("2027-01-01");
    expect(nextDayKey("2028-02-28")).toBe("2028-02-29");
  });

  it("counts slots, not rows, so two accounts do not double the number", () => {
    const items = [1, 2, 3].flatMap((slot) => [row("2026-10-11", slot), row("2026-10-11", slot)]);
    expect(tomorrowReady([row("2026-10-10", 1), ...items], "2026-10-10")).toEqual({ date: "2026-10-11", posts: 3 });
  });

  it("is null until the autopilot has written tomorrow, and ignores hand-added and stream posts", () => {
    expect(tomorrowReady([row("2026-10-10", 1)], "2026-10-10")).toBeNull();
    expect(tomorrowReady(undefined, "2026-10-10")).toBeNull();
    expect(tomorrowReady([row("2026-10-11", 0, "pipeline")], "2026-10-10")).toBeNull();
  });
});
