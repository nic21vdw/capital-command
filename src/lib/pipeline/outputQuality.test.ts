import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_QUALITY,
  OUTPUT_FRAME_RATES,
  OUTPUT_RESOLUTIONS,
  describeOutputQuality,
  normalizeOutputQuality,
  outputFrameRateCap,
  outputHeightCap
} from "./outputQuality";

describe("output quality options", () => {
  it("offers source first, then only sizes and rates a recording can be scaled DOWN to", () => {
    expect(OUTPUT_RESOLUTIONS[0]).toEqual({ id: "source", label: "Source (best)" });
    expect(OUTPUT_RESOLUTIONS.map((option) => option.id)).toEqual(["source", "2160", "1440", "1080", "720"]);
    expect(OUTPUT_FRAME_RATES[0]).toEqual({ id: "source", label: "Source (best)" });
    expect(OUTPUT_FRAME_RATES.map((option) => option.id)).toEqual(["source", "60", "30", "24"]);
    expect(OUTPUT_RESOLUTIONS.map((option) => option.label)).toContain("4K 2160p");
    expect(OUTPUT_FRAME_RATES.map((option) => option.label)).toContain("60 fps");
  });

  it("defaults to whatever the recording already is", () => {
    expect(DEFAULT_OUTPUT_QUALITY).toEqual({ resolution: "source", frameRate: "source" });
  });
});

describe("normalizeOutputQuality", () => {
  it("keeps a valid choice", () => {
    expect(normalizeOutputQuality({ resolution: "1080", frameRate: "60" })).toEqual({
      resolution: "1080",
      frameRate: "60"
    });
  });

  it("falls back to source for anything it does not recognise", () => {
    expect(normalizeOutputQuality(undefined)).toEqual(DEFAULT_OUTPUT_QUALITY);
    expect(normalizeOutputQuality(null)).toEqual(DEFAULT_OUTPUT_QUALITY);
    expect(normalizeOutputQuality("1080p")).toEqual(DEFAULT_OUTPUT_QUALITY);
    expect(normalizeOutputQuality({ resolution: "8k", frameRate: "120" })).toEqual(DEFAULT_OUTPUT_QUALITY);
  });

  it("repairs one bad field without discarding the other", () => {
    expect(normalizeOutputQuality({ resolution: "720", frameRate: "banana" })).toEqual({
      resolution: "720",
      frameRate: "source"
    });
  });

  it("accepts the numbers a hand-written request body would send", () => {
    expect(normalizeOutputQuality({ resolution: 1440, frameRate: 30 })).toEqual({
      resolution: "1440",
      frameRate: "30"
    });
  });
});

describe("describeOutputQuality", () => {
  it("says source quality when nothing is being capped", () => {
    expect(describeOutputQuality({ resolution: "source", frameRate: "source" })).toBe("Source quality");
  });

  it("names both caps when both are set", () => {
    expect(describeOutputQuality({ resolution: "1080", frameRate: "60" })).toBe("1080p · 60 fps");
  });

  it("says which half is still following the source", () => {
    expect(describeOutputQuality({ resolution: "720", frameRate: "source" })).toBe("720p · source fps");
    expect(describeOutputQuality({ resolution: "source", frameRate: "24" })).toBe("Source size · 24 fps");
  });
});

describe("caps", () => {
  it("reads source as no ceiling at all", () => {
    expect(outputHeightCap(DEFAULT_OUTPUT_QUALITY)).toBeNull();
    expect(outputFrameRateCap(DEFAULT_OUTPUT_QUALITY)).toBeNull();
  });

  it("reads a chosen value as a number the render can compare against", () => {
    expect(outputHeightCap({ resolution: "2160", frameRate: "source" })).toBe(2160);
    expect(outputFrameRateCap({ resolution: "source", frameRate: "30" })).toBe(30);
  });
});
