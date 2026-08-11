import { describe, expect, it } from "vitest";
import {
  centerBlurCoverScale,
  centerBlurVideoHeightFrac,
  centerBlurVideoTopFrac,
  clampCenterBlurZoom,
  DEFAULT_CENTER_BLUR_ZOOM,
  MAX_CENTER_BLUR_ZOOM
} from "./centerBlur";

const frame = { width: 1080, height: 1920 };
const widescreen = { width: 1920, height: 1080 };

describe("clampCenterBlurZoom", () => {
  it("never shrinks the video and never crops past the ceiling", () => {
    expect(clampCenterBlurZoom(0.4)).toBe(1);
    expect(clampCenterBlurZoom(99)).toBe(MAX_CENTER_BLUR_ZOOM);
    expect(clampCenterBlurZoom(1.4)).toBe(1.4);
  });

  it("falls back to the default rather than NaN when nothing was chosen", () => {
    expect(clampCenterBlurZoom(undefined)).toBe(DEFAULT_CENTER_BLUR_ZOOM);
    expect(clampCenterBlurZoom(Number.NaN)).toBe(DEFAULT_CENTER_BLUR_ZOOM);
  });
});

describe("centerBlurVideoHeightFrac", () => {
  it("gives the punched-in video more of the frame than the plain contain fit", () => {
    const plain = centerBlurVideoHeightFrac(widescreen, frame, 1);
    const zoomed = centerBlurVideoHeightFrac(widescreen, frame, DEFAULT_CENTER_BLUR_ZOOM);
    expect(plain).toBeCloseTo(0.316, 3);
    expect(zoomed).toBeCloseTo(0.396, 3);
    expect(zoomed).toBeGreaterThan(plain);
  });

  it("never claims more than the whole frame, however hard it is zoomed", () => {
    expect(centerBlurVideoHeightFrac(widescreen, frame, MAX_CENTER_BLUR_ZOOM)).toBeLessThanOrEqual(1);
    expect(centerBlurVideoHeightFrac({ width: 1080, height: 1920 }, frame, 2)).toBe(1);
  });
});

describe("centerBlurVideoTopFrac", () => {
  it("splits what is left of the frame evenly above and below the video", () => {
    expect(centerBlurVideoTopFrac(widescreen, frame, 1)).toBeCloseTo(0.342, 3);
    expect(centerBlurVideoTopFrac(widescreen, frame)).toBeCloseTo(0.302, 3);
  });
});

describe("centerBlurCoverScale", () => {
  it("is 1 for a file already the shape of the frame, so it is never re-zoomed", () => {
    expect(centerBlurCoverScale(9 / 16, 9 / 16)).toBe(1);
  });

  it("leaves room to punch a widescreen source into a vertical frame", () => {
    expect(centerBlurCoverScale(16 / 9, 9 / 16)).toBeCloseTo(3.16, 2);
  });
});
