import { describe, expect, it } from "vitest";
import {
  copyPlatformFor,
  PLATFORM_LABELS,
  PLATFORM_TARGET_LABELS,
  targetPlatforms
} from "@/components/uploading-center/use-uploading-center";
import { ALL_PLATFORMS, type PlatformId } from "@/lib/publisher/types";

describe("targetPlatforms", () => {
  it("expands the all-platforms target to every platform", () => {
    expect(targetPlatforms("all")).toEqual(ALL_PLATFORMS);
  });

  it("leaves a single platform alone", () => {
    for (const platform of ALL_PLATFORMS) {
      expect(targetPlatforms(platform)).toEqual([platform]);
    }
  });

  it("never hands back the shared ALL_PLATFORMS array", () => {
    const platforms = targetPlatforms("all");
    platforms.pop();
    expect(ALL_PLATFORMS).toHaveLength(4);
  });
});

describe("PLATFORM_TARGET_LABELS", () => {
  it("offers All platforms first, then every platform", () => {
    expect(Object.keys(PLATFORM_TARGET_LABELS)).toEqual(["all", ...Object.keys(PLATFORM_LABELS)]);
  });

  it("labels every platform the same way the rest of the page does", () => {
    for (const platform of Object.keys(PLATFORM_LABELS) as PlatformId[]) {
      expect(PLATFORM_TARGET_LABELS[platform]).toBe(PLATFORM_LABELS[platform]);
    }
  });
});

describe("copyPlatformFor", () => {
  it("writes all-platforms copy for the longest-form platform", () => {
    expect(copyPlatformFor("all")).toBe("youtube");
  });

  it("writes single-platform copy for that platform", () => {
    expect(copyPlatformFor("tiktok")).toBe("tiktok");
  });
});
