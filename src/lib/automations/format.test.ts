import { describe, expect, it } from "vitest";
import { describeInterval, describeTaskResult } from "@/lib/automations/format";

describe("describeInterval", () => {
  it("turns ISO durations into plain words", () => {
    expect(describeInterval("PT5M")).toBe("every 5 min");
    expect(describeInterval("PT1M")).toBe("every 1 min");
    expect(describeInterval("PT1H")).toBe("every hour");
    expect(describeInterval("PT2H")).toBe("every 2 hours");
    expect(describeInterval("PT1H30M")).toBe("every 1 hour 30 min");
    expect(describeInterval("PT90S")).toBe("every 90 sec");
    expect(describeInterval("P1D")).toBe("every day");
    expect(describeInterval("P1DT12H")).toBe("every 1 day 12 hours");
  });

  it("leaves values that are not durations alone, and passes empties through as null", () => {
    expect(describeInterval("2026-10-01T09:00:00")).toBe("2026-10-01T09:00:00");
    expect(describeInterval("PT")).toBe("PT");
    expect(describeInterval("")).toBeNull();
    expect(describeInterval(null)).toBeNull();
    expect(describeInterval(undefined)).toBeNull();
  });
});

describe("describeTaskResult", () => {
  it("names the codes people actually meet and keeps the rest generic", () => {
    expect(describeTaskResult(0)).toBe("finished normally");
    expect(describeTaskResult(267009)).toBe("still running");
    expect(describeTaskResult(267011)).toBe("has not run yet");
    expect(describeTaskResult(1)).toBe("ended with an error");
    expect(describeTaskResult(null)).toBe("no result recorded");
  });
});
