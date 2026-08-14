import { describe, expect, it } from "vitest";
import { appleEmojiUrl, appleEmojiUrls, emojiCodepoints, emojiImageKey, emojiIn, hasEmoji, splitRuns } from "./apple";

describe("emojiCodepoints", () => {
  it("maps a single-codepoint emoji to its lowercase hex codepoint", () => {
    expect(emojiCodepoints("🔥")).toBe("1f525");
    expect(emojiCodepoints("🚀")).toBe("1f680");
  });

  it("drops the variation selector so it matches the Apple image keys", () => {
    expect(emojiCodepoints("✅️")).toBe("2705");
    expect(emojiCodepoints("🛠️")).toBe("1f6e0");
  });

  it("keeps the zero-width joiner, which the sequence filenames carry", () => {
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

describe("emojiImageKey", () => {
  it("cannot collide with an image layer's src", () => {
    expect(emojiImageKey("⚡")).toBe("emoji:26a1");
  });
});

describe("splitRuns", () => {
  it("leaves copy with no emoji as one run", () => {
    expect(splitRuns("Ship it today")).toEqual([{ emoji: false, text: "Ship it today" }]);
  });

  it("lifts the emoji out and keeps the spacing around it", () => {
    expect(splitRuns("🚀 Ship it")).toEqual([
      { emoji: true, text: "🚀" },
      { emoji: false, text: " Ship it" }
    ]);
    expect(splitRuns("Ship it 🔥")).toEqual([
      { emoji: false, text: "Ship it " },
      { emoji: true, text: "🔥" }
    ]);
  });

  it("keeps a joined sequence together rather than splitting it into parts", () => {
    expect(splitRuns("👨‍🚀 go")).toEqual([
      { emoji: true, text: "👨‍🚀" },
      { emoji: false, text: " go" }
    ]);
  });

  it("keeps a skin tone with the hand it belongs to", () => {
    expect(splitRuns("👍🏽")).toEqual([{ emoji: true, text: "👍🏽" }]);
  });

  it("carries the variation selector into the run so the picture is found", () => {
    const runs = splitRuns("🛠️ build");
    expect(runs[0].emoji).toBe(true);
    expect(emojiCodepoints(runs[0].text)).toBe("1f6e0");
  });

  it("treats a flag as one emoji, not two letters", () => {
    expect(splitRuns("🇨🇦")).toEqual([{ emoji: true, text: "🇨🇦" }]);
  });

  it("leaves text-presentation pictographs as text", () => {
    // © ® ™ are Extended_Pictographic but are typed as punctuation; swapping
    // them for a picture mid-sentence is the failure this rule prevents.
    expect(splitRuns("CoLateral© 2026")).toEqual([{ emoji: false, text: "CoLateral© 2026" }]);
    expect(splitRuns("Capital Command™")).toEqual([{ emoji: false, text: "Capital Command™" }]);
  });

  it("takes a pictograph the copy explicitly asked to see as emoji", () => {
    expect(splitRuns("©️")).toEqual([{ emoji: true, text: "©️" }]);
  });
});

describe("emojiIn", () => {
  it("lists each distinct glyph once, in the order it first appears", () => {
    expect(emojiIn("🚀 fast 🔥 hot 🚀 again")).toEqual(["🚀", "🔥"]);
  });

  it("is empty for plain copy", () => {
    expect(emojiIn("no pictures here")).toEqual([]);
  });
});

describe("hasEmoji", () => {
  it("does not carry lastIndex between calls", () => {
    expect(hasEmoji("🚀")).toBe(true);
    expect(hasEmoji("🚀")).toBe(true);
  });
});

describe("appleEmojiUrls", () => {
  it("offers one name for a glyph with no variation selector", () => {
    expect(appleEmojiUrls("🚀")).toEqual([
      "https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/1f680.png"
    ]);
  });

  it("offers the FE0F name as a fallback, which is the only one 🛠️ has", () => {
    expect(appleEmojiUrls("🛠️")).toEqual([
      "https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/1f6e0.png",
      "https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64/1f6e0-fe0f.png"
    ]);
  });
});
