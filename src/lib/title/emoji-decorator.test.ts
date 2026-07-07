import { describe, expect, it } from "vitest";
import { decorateTitle, hasEmoji, resolveCategory } from "./emoji-decorator";
import { normalizeEmojiConfig, type EmojiConfig } from "./emoji-config";

// A fixed config mirroring the shipped config/emoji_config.json shape so the
// tests are deterministic and independent of the on-disk file.
const baseConfig = (overrides: Partial<EmojiConfig> = {}): EmojiConfig =>
  normalizeEmojiConfig({
    enabled: true,
    mode: "contextual",
    position: "prefix",
    maxEmoji: 1,
    category_map: {
      structural: ["🏗️", "📐", "👀"],
      ai: ["🤖", "⚡", "🔥"],
      build_in_public: ["🚀", "🔨"],
      hype: ["🔥", "😂", "😎", "🙏", "❤️"],
      fail: ["💩", "😭", "😢"],
      default: []
    },
    fallback: ["🔥", "👀"],
    categoryKeywords: {
      structural: ["structural", "beam", "load"],
      ai: ["ai", "claude", "agent"],
      fail: ["fail", "mistake", "bug"]
    },
    ...overrides
  });

// Deterministic RNG that always returns 0 → picks the first glyph in a pool.
const firstPick = () => 0;

describe("hasEmoji", () => {
  it("detects emoji in a title", () => {
    expect(hasEmoji("🔥 Big news")).toBe(true);
    expect(hasEmoji("Big news ❤️")).toBe(true);
  });
  it("is false for plain text", () => {
    expect(hasEmoji("Just a normal title")).toBe(false);
    expect(hasEmoji("Version 2.0 — the sequel")).toBe(false);
  });
});

describe("resolveCategory", () => {
  const config = baseConfig();
  it("returns an exact category key", () => {
    expect(resolveCategory("structural", config)).toBe("structural");
  });
  it("keyword-matches free text onto a category", () => {
    expect(resolveCategory("How I sized this steel beam", config)).toBe("structural");
    expect(resolveCategory("Building an AI agent live", config)).toBe("ai");
  });
  it("falls back to default for absent or unknown input", () => {
    expect(resolveCategory(undefined, config)).toBe("default");
    expect(resolveCategory("", config)).toBe("default");
    expect(resolveCategory("gardening tips", config)).toBe("default");
  });
});

describe("decorateTitle — contextual mode", () => {
  it("injects one category emoji on a hit (prefix)", () => {
    const r = decorateTitle("Sizing a steel beam", "structural", baseConfig(), { random: firstPick });
    expect(r.emojiUsed).toBe(true);
    expect(r.emojiChar).toBe("🏗️");
    expect(r.decoratedTitle).toBe("🏗️ Sizing a steel beam");
  });

  it("supports suffix position", () => {
    const r = decorateTitle("Sizing a steel beam", "structural", baseConfig({ position: "suffix" }), {
      random: firstPick
    });
    expect(r.decoratedTitle).toBe("Sizing a steel beam 🏗️");
    expect(r.emojiChar).toBe("🏗️");
  });

  it("leaves the title unchanged for an empty category", () => {
    const r = decorateTitle("A plain title", "default", baseConfig(), { random: firstPick });
    expect(r).toEqual({ decoratedTitle: "A plain title", emojiUsed: false, emojiChar: null });
  });

  it("treats a missing category as default (no emoji)", () => {
    const r = decorateTitle("A plain title", undefined, baseConfig(), { random: firstPick });
    expect(r.emojiUsed).toBe(false);
    expect(r.decoratedTitle).toBe("A plain title");
  });

  it("skips a title that already has an emoji (no doubling)", () => {
    const r = decorateTitle("🔥 Already hot", "structural", baseConfig(), { random: firstPick });
    expect(r.emojiUsed).toBe(false);
    expect(r.decoratedTitle).toBe("🔥 Already hot");
  });

  it("never adds more than one glyph and changes length by exactly glyph + space", () => {
    const title = "The biggest mistake new engineers make";
    const r = decorateTitle(title, "fail", baseConfig(), { random: firstPick });
    expect(r.emojiUsed).toBe(true);
    expect(r.decoratedTitle).toBe(`${r.emojiChar} ${title}`);
    // Exactly the glyph plus one separating space were added.
    expect(r.decoratedTitle.length).toBe(title.length + r.emojiChar!.length + 1);
  });
});

describe("decorateTitle — selection varies", () => {
  it("picks different glyphs as the RNG advances", () => {
    const config = baseConfig();
    const a = decorateTitle("Live build", "hype", config, { random: () => 0 });
    const b = decorateTitle("Live build", "hype", config, { random: () => 0.5 });
    expect(a.emojiChar).not.toBe(b.emojiChar);
  });
});

describe("decorateTitle — always mode", () => {
  it("injects even when the resolved category is empty, using the fallback pool", () => {
    const config = baseConfig({ mode: "always" });
    const r = decorateTitle("Some off-topic title", "gardening", config, { random: firstPick });
    expect(r.emojiUsed).toBe(true);
    expect(config.fallback).toContain(r.emojiChar);
  });

  it("prefers the category pool over the fallback when the category has entries", () => {
    const config = baseConfig({ mode: "always" });
    const r = decorateTitle("Beam talk", "structural", config, { random: firstPick });
    expect(r.emojiChar).toBe("🏗️");
  });
});

describe("decorateTitle — off / disabled", () => {
  it("off mode returns the title byte-for-byte", () => {
    const title = "Untouched title";
    const r = decorateTitle(title, "structural", baseConfig({ mode: "off" }), { random: firstPick });
    expect(r).toEqual({ decoratedTitle: title, emojiUsed: false, emojiChar: null });
  });

  it("enabled:false returns the title byte-for-byte", () => {
    const title = "Untouched title";
    const r = decorateTitle(title, "structural", baseConfig({ enabled: false }), { random: firstPick });
    expect(r.decoratedTitle).toBe(title);
    expect(r.emojiUsed).toBe(false);
  });
});
