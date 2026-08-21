import { describe, expect, it } from "vitest";
import {
  FACECAM_SAMPLE_HEIGHT,
  FACECAM_SAMPLE_WIDTH,
  detectFacecam,
  faceCrop,
  isSkin,
  skinFraction,
  skinMask
} from "@/lib/longform/facecam";
import { consensusRect, medianRect } from "@/lib/longform/thumbnail";

const W = FACECAM_SAMPLE_WIDTH;
const H = FACECAM_SAMPLE_HEIGHT;

function blankFrame(r = 20, g = 22, b = 28): Uint8Array {
  const rgb = new Uint8Array(W * H * 3);
  for (let index = 0; index < W * H; index += 1) {
    rgb[index * 3] = r;
    rgb[index * 3 + 1] = g;
    rgb[index * 3 + 2] = b;
  }
  return rgb;
}

function paint(rgb: Uint8Array, x: number, y: number, w: number, h: number, [r, g, b]: [number, number, number]) {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      const offset = (row * W + col) * 3;
      rgb[offset] = r;
      rgb[offset + 1] = g;
      rgb[offset + 2] = b;
    }
  }
}

const SKIN: [number, number, number] = [205, 150, 120];

describe("isSkin", () => {
  it("accepts a lit face tone and rejects the room behind it", () => {
    expect(isSkin(205, 150, 120)).toBe(true);
    expect(isSkin(20, 22, 28)).toBe(false);
    expect(isSkin(240, 240, 240)).toBe(false);
    expect(isSkin(90, 140, 200)).toBe(false);
  });
});

describe("skinMask", () => {
  it("marks only the painted region", () => {
    const rgb = blankFrame();
    paint(rgb, 10, 10, 6, 6, SKIN);
    expect(skinMask(rgb).reduce((sum: number, cell: number) => sum + cell, 0)).toBe(36);
  });
});

describe("detectFacecam", () => {
  it("returns null for a frame with nothing person-shaped in it", () => {
    expect(detectFacecam(blankFrame())).toBeNull();
  });

  it("finds a facecam pane in the top-right corner", () => {
    const rgb = blankFrame();
    paint(rgb, W - 40, 0, 40, 28, [235, 232, 226]);
    paint(rgb, W - 30, 6, 16, 18, SKIN);

    const rect = detectFacecam(rgb);
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThan(0.55);
    expect(rect!.y).toBeLessThan(0.2);
  });

  it("stops at the pane edge instead of running into what is underneath", () => {
    const rgb = blankFrame(12, 12, 16);
    paint(rgb, W - 40, 0, 40, 28, [235, 232, 226]);
    paint(rgb, W - 30, 6, 16, 18, SKIN);

    const rect = detectFacecam(rgb)!;
    const bottom = (rect.y + rect.height) * H;
    expect(bottom).toBeLessThanOrEqual(34);
  });
});

describe("faceCrop", () => {
  it("keeps the crop inside the frame", () => {
    const crop = faceCrop({ x: 0.85, y: 0.02, width: 0.2, height: 0.3 }, 16 / 9);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1.0001);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1.0001);
  });

  it("caps a letterbox pane down to a portrait-ish tile", () => {
    const crop = faceCrop({ x: 0.1, y: 0.4, width: 0.8, height: 0.1 }, 16 / 9);
    const pixelRatio = (crop.width * (16 / 9)) / crop.height;
    expect(pixelRatio).toBeLessThanOrEqual(1.51);
  });

  it("measures squareness in pixels, not in normalised units", () => {
    const crop = faceCrop({ x: 0.4, y: 0.3, width: 0.2, height: 0.3555 }, 16 / 9);
    expect(crop.width).toBeLessThan(crop.height);
  });
});

describe("medianRect", () => {
  it("ignores a single frame that disagrees with the rest", () => {
    const good = { x: 0.78, y: 0, width: 0.22, height: 0.3 };
    const rect = medianRect([good, good, { x: 0.1, y: 0.5, width: 0.6, height: 0.6 }, good])!;
    expect(rect.x).toBeCloseTo(0.78, 5);
    expect(rect.width).toBeCloseTo(0.22, 5);
  });

  it("passes a lone rect straight through and handles nothing at all", () => {
    const only = { x: 1, y: 2, width: 3, height: 4 };
    expect(medianRect([only])).toEqual(only);
    expect(medianRect([])).toBeNull();
  });
});

describe("skinFraction", () => {
  it("is high for a region full of face and near zero for a title card", () => {
    const rgb = blankFrame(235, 232, 226);
    paint(rgb, W - 40, 0, 40, 28, SKIN);
    const pane = { x: (W - 40) / W, y: 0, width: 40 / W, height: 28 / H };
    expect(skinFraction(rgb, pane)).toBeCloseTo(1, 2);
    expect(skinFraction(blankFrame(235, 232, 226), pane)).toBe(0);
  });

  it("is zero for a region with no area", () => {
    expect(skinFraction(blankFrame(), { x: 0.5, y: 0.5, width: 0, height: 0 })).toBe(0);
  });
});

describe("consensusRect", () => {
  const pane = { x: 0.775, y: 0.03, width: 0.225, height: 0.28 };

  it("takes the corner most frames agree on, not the average of the mistakes", () => {
    const rect = consensusRect([
      pane,
      pane,
      pane,
      { x: 0.1, y: 0.5, width: 0.3, height: 0.4 },
      { x: 0.5, y: 0.1, width: 0.3, height: 0.4 }
    ])!;
    expect(rect.x).toBeCloseTo(pane.x, 5);
    expect(rect.y).toBeCloseTo(pane.y, 5);
  });

  it("falls back to the median when there is barely anything to go on", () => {
    expect(consensusRect([])).toBeNull();
    expect(consensusRect([pane])).toEqual(pane);
    expect(consensusRect([pane, pane])).toEqual(medianRect([pane, pane]));
  });
});
