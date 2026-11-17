import { describe, expect, it } from "vitest";
import { bareTags, composeCaption, composeDescription } from "@/lib/publisher/metadata";

const item = { caption: "Building in public.", hashtags: ["#shorts", "#AI", "#VibeCoding"] };

describe("the #shorts tag only travels with a YouTube Short", () => {
  it("stays on the YouTube description and tags of a short", () => {
    expect(composeDescription(item)).toContain("#shorts #AI #VibeCoding");
    expect(bareTags(item)).toEqual(["shorts", "AI", "VibeCoding"]);
  });

  it.each(["instagram", "facebook", "tiktok", "linkedin"] as const)("is left off %s", (platform) => {
    const caption = composeCaption(item, platform);
    expect(caption).toContain("#AI #VibeCoding");
    expect(caption.toLowerCase()).not.toContain("#shorts");
  });

  it("is left off a long-form upload everywhere", () => {
    const long = { ...item, format: "long" as const };
    expect(composeDescription(long)).not.toContain("#shorts");
    expect(composeCaption(long, "instagram")).not.toContain("#shorts");
    expect(bareTags(long)).toEqual(["AI", "VibeCoding"]);
  });

  it("matches the tag whatever its case", () => {
    expect(composeCaption({ ...item, hashtags: ["#Shorts", "#AI"] }, "instagram")).not.toMatch(/#shorts/i);
  });
});
