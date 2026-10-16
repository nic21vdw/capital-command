import { describe, expect, it } from "vitest";
import { highlightCoverage } from "./highlightCoverage";

describe("retained visual evidence", () => {
  it("does not turn one successful review into complete coverage", () => {
    expect(highlightCoverage([
      { enabled: true, visual: { source: "vision", verdict: "keep", note: "Readable" } },
      { enabled: true, visual: { source: "scan", verdict: "keep", note: "Nonblank" } },
      { enabled: true },
      { enabled: false, visual: { source: "vision", verdict: "keep", note: "Excluded" } }
    ])).toEqual({ total: 3, vision: 1, scan: 1, rejected: 0, unchecked: 1, level: "scan" });
  });
  it("treats a manually restored rejected passage as rejected", () => {
    expect(highlightCoverage([{ enabled: true, visual: { source: "vision", verdict: "drop", note: "Private screen" } }]).rejected).toBe(1);
    expect(highlightCoverage([]).level).toBe("none");
  });
});
