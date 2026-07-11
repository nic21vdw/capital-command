import { describe, expect, it } from "vitest";
import { appendHashtag, SUGGESTED_HASHTAGS, TITLE_MAX_LENGTH } from "@/components/uploading-center/clip-card";

describe("appendHashtag", () => {
  it("appends with a separating space", () => {
    expect(appendHashtag("My clip", "#AI")).toBe("My clip #AI");
  });

  it("uses the hashtag alone when the title is empty", () => {
    expect(appendHashtag("", "#coding")).toBe("#coding");
  });

  it("does not double up whitespace on titles with trailing spaces", () => {
    expect(appendHashtag("My clip ", "#AI")).toBe("My clip #AI");
  });

  it("leaves the title unchanged when the hashtag would exceed the limit", () => {
    const long = "x".repeat(TITLE_MAX_LENGTH - 2);
    expect(appendHashtag(long, "#business")).toBe(long);
  });

  it("never produces a title over the limit for any suggested hashtag", () => {
    for (const hashtag of SUGGESTED_HASHTAGS) {
      for (const length of [0, 50, 90, TITLE_MAX_LENGTH]) {
        expect(appendHashtag("y".repeat(length), hashtag).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
      }
    }
  });
});
