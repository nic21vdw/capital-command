import { describe, expect, it } from "vitest";
import {
  IMAGE_POST_MAX_WIDTH,
  IMAGE_POST_MIN_WIDTH,
  imagePathsOf,
  imagePostUrl,
  imagePostWidth,
  isCarouselPost,
  isImagePost,
  splitImagePlatforms
} from "@/lib/publisher/images";
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

describe("the size a picture post may be", () => {
  it("pulls a frame that is too wide back to the widest allowed", () => {
    expect(imagePostWidth(1920)).toBe(IMAGE_POST_MAX_WIDTH);
    expect(imagePostWidth(64)).toBe(IMAGE_POST_MIN_WIDTH);
    expect(imagePostWidth(1080)).toBe(1080);
  });
});

describe("reaching a queued picture from the browser", () => {
  it("addresses it by queue position, never by the path it sits at", () => {
    expect(imagePostUrl("a1b2c3", 0)).toBe("/api/publish/a1b2c3/images/0");
    expect(imagePostUrl("a1b2c3", 7, { download: true })).toBe("/api/publish/a1b2c3/images/7?download=1");
  });
});
