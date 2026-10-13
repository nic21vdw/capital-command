import { describe, expect, it } from "vitest";
import { describeInterval, truncateAtWord, describeTaskResult } from "@/lib/automations/format";

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

describe("truncateAtWord", () => {
  it("leaves short text alone", () => {
    expect(truncateAtWord("Day 42 full edit", 60)).toBe("Day 42 full edit");
  });

  it("cuts on a word boundary with an ellipsis, never mid-word", () => {
    const out = truncateAtWord("Three agents, one repo, here is the truth about how I stop merge fights", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toBe("Three agents, one repo, here is the…");
  });

  it("collapses whitespace and survives one very long word", () => {
    expect(truncateAtWord("a\n\n  b", 10)).toBe("a b");
    expect(truncateAtWord("x".repeat(80), 20)).toBe(`${"x".repeat(19)}…`);
    expect(truncateAtWord(undefined, 10)).toBe("");
  });
});
