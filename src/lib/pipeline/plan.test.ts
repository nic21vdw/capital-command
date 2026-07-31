import { describe, expect, it } from "vitest";
import { MIN_SLIDES } from "@/lib/carousels/deck";
import { MAX_CLIP_COUNT } from "@/lib/clipping/clip-count";
import {
  defaultPipelinePlan,
  describePlan,
  normalizePipelinePlan,
  plannedOutputs,
  plannedPostCount
} from "@/lib/pipeline/plan";

describe("defaultPipelinePlan", () => {
  it("turns on every format, so a run started without a plan behaves as it always did", () => {
    const plan = defaultPipelinePlan();
    expect(plan.longform).toBe(true);
    expect(plan.segments).toBe(true);
    expect(plan.audio).toBe(true);
    expect(plan.visualAd).toBe(true);
    expect(plan.clipCount).toBeGreaterThan(0);
    expect(plan.carouselSlides).toBeGreaterThan(0);
    expect(plan.postPlatforms).toEqual(["x", "threads", "facebook"]);
  });
});

describe("normalizePipelinePlan", () => {
  it("keeps the base for anything the patch leaves out", () => {
    const base = { ...defaultPipelinePlan(), clipCount: 4 };
    expect(normalizePipelinePlan({ segments: false }, base)).toMatchObject({ clipCount: 4, segments: false });
  });

  it("clamps a clip count outside the supported range", () => {
    expect(normalizePipelinePlan({ clipCount: 9999 }).clipCount).toBe(MAX_CLIP_COUNT);
    expect(normalizePipelinePlan({ clipCount: 0 }).clipCount).toBe(1);
  });

  it("treats zero slides as 'no carousel' instead of clamping up to the deck minimum", () => {
    expect(normalizePipelinePlan({ carouselSlides: 0 }).carouselSlides).toBe(0);
    expect(normalizePipelinePlan({ carouselSlides: 2 }).carouselSlides).toBe(MIN_SLIDES);
  });

  // The MP3 is cut out of the finished long-form export, so asking for audio
  // without the edit is asking for a file that has nothing to come from.
  it("turns the MP3 off with the long-form edit", () => {
    expect(normalizePipelinePlan({ longform: false, audio: true }).audio).toBe(false);
  });

  it("drops unknown post platforms and keeps a canonical order", () => {
    expect(normalizePipelinePlan({ postPlatforms: ["mastodon", "facebook", "x"] }).postPlatforms).toEqual([
      "x",
      "facebook"
    ]);
  });

  it("accepts an empty platform list as 'no posts' rather than falling back to all", () => {
    expect(normalizePipelinePlan({ postPlatforms: [] }).postPlatforms).toEqual([]);
  });

  it("survives junk from the wire", () => {
    expect(normalizePipelinePlan(null)).toEqual(defaultPipelinePlan());
    expect(normalizePipelinePlan({ clipCount: "ten" }).clipCount).toBe(defaultPipelinePlan().clipCount);
  });
});

describe("plannedOutputs", () => {
  it("promises the counts the plan actually asked for", () => {
    const plan = { ...defaultPipelinePlan(), clipCount: 3, carouselSlides: 12 };
    const outputs = plannedOutputs(plan);
    expect(outputs.find((output) => output.key === "clips")?.detail).toContain("3 vertical clips");
    expect(outputs.find((output) => output.key === "images")?.detail).toContain("12-slide");
  });

  it("marks a format the plan left out as disabled instead of dropping the row", () => {
    const outputs = plannedOutputs({ ...defaultPipelinePlan(), segments: false, carouselSlides: 0 });
    expect(outputs.find((output) => output.key === "segments")?.enabled).toBe(false);
    expect(outputs.find((output) => output.key === "images")?.enabled).toBe(false);
    expect(outputs).toHaveLength(7);
  });

  it("counts the posts each chosen feed will get", () => {
    expect(plannedPostCount({ ...defaultPipelinePlan(), postPlatforms: ["x"] })).toBe(3);
    expect(plannedPostCount({ ...defaultPipelinePlan(), postPlatforms: [] })).toBe(0);
  });
});

describe("describePlan", () => {
  it("lists only what the run is going to produce", () => {
    const line = describePlan({ ...defaultPipelinePlan(), longform: false, audio: false, visualAd: false });
    expect(line).toContain("short-form clips");
    expect(line).not.toContain("podcast mp3");
    expect(line).not.toContain("long-form edit");
  });
});
