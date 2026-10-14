import { describe, expect, it } from "vitest";
import { postCode } from "@/lib/attribution/code";
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

describe("per-post codes on attribution links", () => {
  const code = postCode("clip-1");

  it.each([
    ["youtube", "yt"],
    ["instagram", "ig"],
    ["tiktok", "tt"],
    ["facebook", "fb"],
    ["threads", "th"],
    ["x", "x"]
  ] as const)("adds the code to the %s link", (platform, path) => {
    expect(attributeLinks("Try https://colateralai.com", platform, code)).toBe(`Try https://colateralai.com/${path}?c=${code}`);
  });

  it("keeps trailing punctuation after the coded link", () => {
    expect(attributeLinks("See https://colateralai.com.", "instagram", code)).toBe(`See https://colateralai.com/ig?c=${code}.`);
    expect(attributeLinks("(colateralai.com)", "tiktok", code)).toBe(`(colateralai.com/tt?c=${code})`);
  });

  it("codes every bare link in the text", () => {
    expect(attributeLinks("a colateralai.com b colateralai.com", "facebook", code)).toBe(
      `a colateralai.com/fb?c=${code} b colateralai.com/fb?c=${code}`
    );
  });

  it("is idempotent and leaves a link that already has a path or query alone", () => {
    const once = attributeLinks("Try https://colateralai.com", "threads", code);
    expect(attributeLinks(once, "threads", code)).toBe(once);
    expect(attributeLinks("https://colateralai.com/yt", "youtube", code)).toBe("https://colateralai.com/yt");
    expect(attributeLinks("https://colateralai.com/th?c=abc123", "threads", code)).toBe("https://colateralai.com/th?c=abc123");
  });

  it("falls back to the plain platform link for a missing or malformed code", () => {
    for (const bad of [undefined, "", "ABC123", "a b", "abc123&x=1", "toolongcode1"]) {
      expect(attributeLinks("colateralai.com", "tiktok", bad)).toBe("colateralai.com/tt");
    }
  });
});

describe("YouTube lead line with a post code", () => {
  const code = postCode("clip-1");
  const coded = `${YOUTUBE_LEAD_LINE}?c=${code}`;

  it("leads with the coded line and codes the body", () => {
    expect(youtubeDescription("Watch.\nTry https://colateralai.com", code)).toBe(
      `${coded}\n\nWatch.\nTry https://colateralai.com/yt?c=${code}`
    );
  });

  it("does not repeat a coded lead line", () => {
    const already = `${coded}\n\nBody`;
    expect(youtubeDescription(already, code)).toBe(already);
    expect(youtubeDescription(already)).toBe(already);
  });

  it("does not stack a coded line on an uncoded one", () => {
    const already = `${YOUTUBE_LEAD_LINE}\n\nBody`;
    expect(youtubeDescription(already, code)).toBe(already);
  });

  it("is just the coded line for an empty description", () => {
    expect(youtubeDescription("", code)).toBe(coded);
  });

  it("still prepends when the first line only looks similar", () => {
    const lookalike = "Try CoLateral: https://colateralai.com/ytx";
    expect(youtubeDescription(lookalike, code).startsWith(coded)).toBe(true);
  });
});

describe("queue posts carry their own code", () => {
  const item = { id: "clip-1", caption: "Clip. https://colateralai.com", hashtags: ["ai"] };
  const code = postCode("clip-1");

  it("codes the caption for each platform from the item id", () => {
    expect(composeCaption(item, "instagram")).toBe(`Clip. https://colateralai.com/ig?c=${code}\n\n#ai`);
    expect(composeCaption(item, "facebook")).toBe(`Clip. https://colateralai.com/fb?c=${code}\n\n#ai`);
    expect(composeCaption(item, "tiktok")).toBe(`Clip. https://colateralai.com/tt?c=${code}\n\n#ai`);
  });

  it("codes the YouTube description", () => {
    expect(composeDescription(item)).toBe(`${YOUTUBE_LEAD_LINE}?c=${code}\n\nClip. https://colateralai.com/yt?c=${code}\n\n#ai`);
  });

  it("gives different posts different codes", () => {
    expect(composeCaption({ ...item, id: "clip-2" }, "instagram")).not.toBe(composeCaption(item, "instagram"));
  });

  it("leaves Buffer text without a platform untouched", () => {
    expect(composeCaption(item)).toBe("Clip. https://colateralai.com\n\n#ai");
  });
});
