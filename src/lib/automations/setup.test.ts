import { describe, expect, it } from "vitest";
import { isNotSetUp } from "@/lib/automations/setup";

describe("isNotSetUp", () => {
  it("counts blocked and never-run cards as not set up", () => {
    expect(isNotSetUp({ state: "blocked" })).toBe(true);
    expect(isNotSetUp({ state: "unknown" })).toBe(true);
  });

  it("keeps running, ready, attention and paused cards in the main list", () => {
    expect(isNotSetUp({ state: "running" })).toBe(false);
    expect(isNotSetUp({ state: "ready" })).toBe(false);
    expect(isNotSetUp({ state: "attention" })).toBe(false);
    expect(isNotSetUp({ state: "paused" })).toBe(false);
  });
});
