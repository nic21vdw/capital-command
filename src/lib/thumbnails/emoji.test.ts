import { describe, expect, it } from "vitest";
import { appleEmojiUrl, emojiCodepoints } from "./emoji";

describe("emojiCodepoints", () => {
  it("maps a single-codepoint emoji to its lowercase hex codepoint", () => {
    expect(emojiCodepoints("🔥")).toBe("1f525");
    expect(emojiCodepoints("🚀")).toBe("1f680");
    expect(emojiCodepoints("✅")).toBe("2705");
    expect(emojiCodepoints("❌")).toBe("274c");
    expect(emojiCodepoints("⚡")).toBe("26a1");
  });

  it("drops the U+FE0F variation selector so it matches the Apple image keys", () => {
    expect(emojiCodepoints("✅️")).toBe("2705");
  });

  it("hyphen-joins multi-codepoint sequences", () => {
    expect(emojiCodepoints("👨‍🚀")).toBe("1f468-200d-1f680");
  });
});

describe("appleEmojiUrl", () => {
  it("builds the CDN URL from the codepoints", () => {
    expect(appleEmojiUrl("🔥")).toBe(
      "https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/1f525.png"
    );
  });
});
