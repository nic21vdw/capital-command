import { describe, expect, it } from "vitest";
import { bodyInputWindow } from "@/lib/longform/body-input";

describe("long-form body input window", () => {
  it("leaves the input options and selectors unchanged near the source opening", () => {
    const ranges = [{ start: 30, end: 60 }, { start: 70.125, end: 120 }];
    const before = structuredClone(ranges);

    expect(bodyInputWindow(ranges)).toEqual({
      inputArgs: ["-t", "121.000"],
      selectRanges: ranges
    });
    expect(ranges).toEqual(before);
  });

  it("bounds late passages with an integer seek and a full minute of discarded preroll", () => {
    const ranges = Object.freeze([
      Object.freeze({ start: 7200.125, end: 7203.5 }),
      Object.freeze({ start: 7210.001, end: 7212.999 })
    ]);

    expect(bodyInputWindow(ranges)).toEqual({
      inputArgs: ["-ss", "7140.000", "-t", "73.999"],
      selectRanges: [
        { start: 60.125, end: 63.5 },
        { start: 70.001, end: 72.999 }
      ]
    });
  });

  it("does not seek until a full minute of preroll remains", () => {
    expect(bodyInputWindow([{ start: 60.999, end: 70 }]).inputArgs).toEqual(["-t", "71.000"]);
    expect(bodyInputWindow([{ start: 61, end: 70 }]).inputArgs).toEqual(["-ss", "1.000", "-t", "70.000"]);
  });

  it("preserves inclusive cut coordinates for irregular frame and audio-packet timestamps", () => {
    const ranges = [{ start: 7200.125, end: 7203.5 }, { start: 7210.001, end: 7212.999 }];
    const { inputArgs, selectRanges } = bodyInputWindow(ranges);
    const offset = Number(inputArgs[1]);
    const kept = (t: number, spans: typeof ranges) => spans.some((span) => t >= span.start && t <= span.end);
    // This verifies selector arithmetic, not native FFmpeg seek/codec behavior.
    for (const sourceT of [7199.999, 7200.124, 7200.125, 7200.157, 7203.5, 7203.501, 7208.64, 7210.001, 7212.999, 7213]) {
      const inputT = Number((sourceT - offset).toFixed(6));
      expect(kept(inputT, selectRanges), String(sourceT)).toBe(kept(sourceT, ranges));
    }
  });

  it("rejects an empty body before constructing an unbounded input", () => {
    expect(() => bodyInputWindow([])).toThrow("The body has no kept ranges.");
  });
});
