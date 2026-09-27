import { describe, expect, it } from "vitest";
import { attributeLinks, youtubeDescription, YOUTUBE_LEAD_LINE } from "@/lib/publisher/attribution";
import { composeCaption, composeDescription } from "@/lib/publisher/metadata";
import { storyVideoBody } from "@/lib/story/youtube";

describe("per-platform attribution links", () => {
  it.each([
    ["youtube", "https://colateralai.com/yt"],
    ["instagram", "https://colateralai.com/ig"],
    ["tiktok", "https://colateralai.com/tt"],
    ["facebook", "https://colateralai.com/fb"],
    ["threads", "https://colateralai.com/th"]
  ] as const)("rewrites the bare domain for %s", (platform, expected) => {
    expect(attributeLinks("Explore CoLateral: https://colateralai.com", platform)).toBe(`Explore CoLateral: ${expected}`);
  });

  it("rewrites a trailing slash, www, schemeless and punctuated forms", () => {
    expect(attributeLinks("Go to https://colateralai.com/ now", "tiktok")).toBe("Go to https://colateralai.com/tt now");
    expect(attributeLinks("See https://www.colateralai.com.", "instagram")).toBe("See https://www.colateralai.com/ig.");
    expect(attributeLinks("colateralai.com", "facebook")).toBe("colateralai.com/fb");
    expect(attributeLinks("(https://colateralai.com)\nnext", "threads")).toBe("(https://colateralai.com/th)\nnext");
  });

  it("rewrites every bare link in the text", () => {
    expect(attributeLinks("a https://colateralai.com b https://colateralai.com", "youtube")).toBe(
      "a https://colateralai.com/yt b https://colateralai.com/yt"
    );
  });

  it("leaves links that already carry a path, query or other host alone", () => {
    const untouched = [
      "https://colateralai.com/download",
      "https://colateralai.com/pricing",
      "https://colateralai.com/yt",
      "https://colateralai.com?ref=x",
      "https://docs.colateralai.com",
      "hello@colateralai.com",
      "https://notcolateralai.com"
    ];
    for (const text of untouched) expect(attributeLinks(text, "tiktok")).toBe(text);
  });
});

describe("YouTube descriptions lead with the CoLateral line", () => {
  it("prepends the line and rewrites the body's links", () => {
    expect(youtubeDescription("Watch this.\nExplore CoLateral: https://colateralai.com")).toBe(
      `${YOUTUBE_LEAD_LINE}\n\nWatch this.\nExplore CoLateral: https://colateralai.com/yt`
    );
  });

  it("does not repeat the line when the description already starts with it", () => {
    const already = `${YOUTUBE_LEAD_LINE}\n\nBody`;
    expect(youtubeDescription(already)).toBe(already);
    expect(youtubeDescription("Try CoLateral: https://colateralai.com\n\nBody")).toBe(already);
  });

  it("is just the line for an empty description", () => {
    expect(youtubeDescription("")).toBe(YOUTUBE_LEAD_LINE);
  });

  it("applies to Shorts descriptions built from the queue", () => {
    const description = composeDescription({ caption: "Clip. https://colateralai.com", hashtags: ["ai"] });
    expect(description).toBe(`${YOUTUBE_LEAD_LINE}\n\nClip. https://colateralai.com/yt\n\n#ai`);
  });

  it("applies to long-form story uploads", () => {
    const body = storyVideoBody({
      title: "t",
      description: "Explore CoLateral: https://colateralai.com",
      tags: [],
      categoryId: "28",
      language: "en",
      madeForKids: false
    });
    expect(body.snippet.description).toBe(`${YOUTUBE_LEAD_LINE}\n\nExplore CoLateral: https://colateralai.com/yt`);
  });
});

describe("composeCaption", () => {
  it("attributes the caption for the platform and keeps hashtags", () => {
    expect(composeCaption({ caption: "Try https://colateralai.com", hashtags: ["build"] }, "instagram")).toBe(
      "Try https://colateralai.com/ig\n\n#build"
    );
  });

  it("leaves the caption alone without a platform", () => {
    expect(composeCaption({ caption: "Try https://colateralai.com", hashtags: [] })).toBe("Try https://colateralai.com");
  });
});
