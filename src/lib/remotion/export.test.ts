import { describe, expect, it } from "vitest";
import { remotionConcurrency, REMOTION_EXPORT } from "@/lib/remotion/export";

describe("remotionConcurrency", () => {
  it("leaves one core free and never drops below 1", () => {
    expect(remotionConcurrency(1)).toBe(1);
    expect(remotionConcurrency(2)).toBe(1);
    expect(remotionConcurrency(4)).toBe(3);
    expect(remotionConcurrency(8)).toBe(7);
  });

  it("caps at 8 so huge boxes do not spawn dozens of Chromium tabs", () => {
    expect(remotionConcurrency(32)).toBe(8);
    expect(remotionConcurrency(64)).toBe(8);
  });
});

describe("REMOTION_EXPORT", () => {
  it("rasterizes 1080p artwork at 4K without an intermediate lossy JPEG", () => {
    expect(REMOTION_EXPORT.scale).toBe(2);
    expect(REMOTION_EXPORT.crf).toBe(17);
    expect(REMOTION_EXPORT.codec).toBe("h264");
    expect(REMOTION_EXPORT.imageFormat).toBe("png");
  });
});
