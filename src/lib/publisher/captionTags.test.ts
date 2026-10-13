import { describe, expect, it } from "vitest";
import { captionRequestFields, splitTrailingHashtags } from "@/lib/publisher/captionTags";

describe("splitTrailingHashtags", () => {
  it("takes the AI caption's hashtag line out of the body", () => {
    expect(splitTrailingHashtags("Ship it before lunch.\n\n#buildinpublic #AI #startup")).toEqual({
      caption: "Ship it before lunch.",
      hashtags: ["#buildinpublic", "#AI", "#startup"]
    });
  });

  it("leaves a caption without a hashtag line alone", () => {
    expect(splitTrailingHashtags("Just words.")).toEqual({ caption: "Just words.", hashtags: [] });
  });

  it("does not take hashtags that are part of a sentence", () => {
    expect(splitTrailingHashtags("I love #coding so much")).toEqual({
      caption: "I love #coding so much",
      hashtags: []
    });
    expect(splitTrailingHashtags("Tags: #a #b")).toEqual({ caption: "Tags: #a #b", hashtags: [] });
  });

  it("handles a caption that is only hashtags, and CRLF line endings", () => {
    expect(splitTrailingHashtags("#a #b")).toEqual({ caption: "", hashtags: ["#a", "#b"] });
    expect(splitTrailingHashtags("Body\r\n\r\n#a #b\r\n")).toEqual({ caption: "Body", hashtags: ["#a", "#b"] });
  });

  it("does not treat a lone # or an empty caption as hashtags", () => {
    expect(splitTrailingHashtags("Number one #")).toEqual({ caption: "Number one #", hashtags: [] });
    expect(splitTrailingHashtags("")).toEqual({ caption: "", hashtags: [] });
  });
});

describe("captionRequestFields", () => {
  it("sends hashtags separately so enqueue does not generate a second block", () => {
    expect(captionRequestFields("Body\n\n#a #b")).toEqual({ caption: "Body", hashtags: ["#a", "#b"] });
  });

  it("omits both fields for an empty draft so enqueue writes the copy", () => {
    expect(captionRequestFields("   ")).toEqual({ caption: undefined });
  });
});
