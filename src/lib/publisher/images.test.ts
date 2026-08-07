import { describe, expect, it } from "vitest";
import { imagePathsOf, isCarouselPost, isImagePost, splitImagePlatforms } from "@/lib/publisher/images";
import { testItem } from "@/lib/publisher/test-helpers";

describe("image posts vs the video posts already in the queue", () => {
  it("treats an item stored before image posts existed as a video", () => {
    const stored = testItem();
    expect(isImagePost(stored)).toBe(false);
    expect(isCarouselPost(stored)).toBe(false);
    expect(imagePathsOf(stored)).toEqual([]);
  });

  it("reads a single image post and a deck", () => {
    const single = testItem({ mediaKind: "image", clipPath: "data/x/1.jpg", imagePaths: ["data/x/1.jpg"] });
    expect(isImagePost(single)).toBe(true);
    expect(isCarouselPost(single)).toBe(false);
    expect(imagePathsOf(single)).toEqual(["data/x/1.jpg"]);

    const deck = testItem({
      mediaKind: "image",
      clipPath: "data/x/1.jpg",
      imagePaths: ["data/x/1.jpg", "data/x/2.jpg"]
    });
    expect(isCarouselPost(deck)).toBe(true);
    expect(imagePathsOf(deck)).toEqual(["data/x/1.jpg", "data/x/2.jpg"]);
  });
});

describe("which platforms can carry a picture", () => {
  it("keeps Instagram and Facebook and refuses the rest with a reason", () => {
    const { supported, refused } = splitImagePlatforms(["youtube", "instagram", "tiktok", "facebook"]);
    expect(supported).toEqual(["instagram", "facebook"]);
    expect(refused.map((entry) => entry.platform)).toEqual(["youtube", "tiktok"]);
    for (const entry of refused) expect(entry.reason.length).toBeGreaterThan(20);
  });
});
