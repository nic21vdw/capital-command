import { describe, expect, it } from "vitest";
import { SAMPLE_HEIGHT, SAMPLE_WIDTH, screenEdgeShare, verdictFromShares } from "@/lib/carousels/footage";

function frame(paint: (x: number, y: number) => number): Uint8Array {
  const gray = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
  for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
    for (let x = 0; x < SAMPLE_WIDTH; x += 1) gray[y * SAMPLE_WIDTH + x] = paint(x, y);
  }
  return gray;
}

describe("screenEdgeShare", () => {
  it("reads high on a frame ruled with panels and rows, the way a screen is", () => {
    const share = screenEdgeShare(frame((x, y) => (x % 12 < 6 ? 40 : 210) + (y % 9 < 4 ? 0 : 12)));
    expect(share).toBeGreaterThan(0.15);
  });

  it("reads low on smooth curved shading, the way a face in a car is", () => {
    const share = screenEdgeShare(frame((x, y) => 128 + 90 * Math.sin((x + y) / 40)));
    expect(share).toBeLessThan(0.15);
  });

  it("reads zero on a flat frame and on a short buffer", () => {
    expect(screenEdgeShare(frame(() => 128))).toBe(0);
    expect(screenEdgeShare(new Uint8Array(10))).toBe(0);
  });
});

describe("verdictFromShares", () => {
  it("calls the real measured populations apart", () => {
    expect(verdictFromShares([0.0858, 0.0784, 0.0761, 0.08, 0.0888])).toBe("talking-head");
    expect(verdictFromShares([0.2596, 0.227, 0.2404, 0.2274, 0.2558])).toBe("desk");
  });

  it("takes the median, so one webcam cutaway does not reclassify a stream", () => {
    expect(verdictFromShares([0.24, 0.23, 0.06, 0.25, 0.22])).toBe("desk");
    expect(verdictFromShares([0.08, 0.07, 0.31, 0.09, 0.08])).toBe("talking-head");
  });

  it("has no verdict with nothing measured — the caller then leaves the deck alone", () => {
    expect(verdictFromShares([])).toBeNull();
  });
});
