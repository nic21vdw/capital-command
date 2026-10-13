import { describe, expect, it } from "vitest";
import { percentChangeLabel, refreshOutcome } from "./youtubeStatsShared";

describe("refreshOutcome", () => {
  it("says the numbers were just checked only when YouTube answered", () => {
    expect(refreshOutcome("ok")).toEqual({ ok: true, text: "Checked YouTube just now." });
  });

  it("does not claim a check when there was no video to ask about", () => {
    expect(refreshOutcome("loading")).toMatchObject({ ok: false });
  });

  it("keeps the cached numbers and says why they were not refreshed", () => {
    expect(refreshOutcome("not-connected")).toMatchObject({ ok: false });
    expect(refreshOutcome("not-connected").text).toContain("not connected");
    expect(refreshOutcome("stale").text).toContain("last saved numbers");
    expect(refreshOutcome("error").ok).toBe(false);
  });
});

describe("percentChangeLabel", () => {
  it("spells the sign out", () => {
    expect(percentChangeLabel(23)).toBe("+23%");
    expect(percentChangeLabel(-8)).toBe("-8%");
    expect(percentChangeLabel(0)).toBe("0%");
  });
});
