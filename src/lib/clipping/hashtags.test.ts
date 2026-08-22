import { describe, expect, it } from "vitest";
import {
  BASE_HASHTAGS,
  MAX_HASHTAGS,
  buildHashtagPrompt,
  fallbackHashtags,
  normalizeHashtag,
  normalizeHashtags,
  parseHashtags
} from "./hashtags";

describe("normalizeHashtag", () => {
  it("adds the prefix and strips what a platform would reject", () => {
    expect(normalizeHashtag("vibe coding!")).toBe("#vibecoding");
    expect(normalizeHashtag("#AI")).toBe("#AI");
  });

  it("drops anything too thin to be a tag", () => {
    expect(normalizeHashtag("#")).toBe("");
    expect(normalizeHashtag("!!")).toBe("");
  });
});

describe("normalizeHashtags", () => {
  it("dedupes case-insensitively and caps the list", () => {
    expect(normalizeHashtags(["#ai", "#AI", "#agents"])).toEqual(["#ai", "#agents"]);
    expect(normalizeHashtags(Array.from({ length: 20 }, (_, i) => `#tag${i}`))).toHaveLength(MAX_HASHTAGS);
  });
});

describe("fallbackHashtags", () => {
  it("always carries the format tag, even with nothing to go on", () => {
    expect(fallbackHashtags({})).toEqual(BASE_HASHTAGS);
  });

  it("tags only the channel keywords the clip actually mentions", () => {
    const tags = fallbackHashtags({ spokenText: "I let Claude do the vibe coding for this SaaS" });
    expect(tags).toContain("#Claude");
    expect(tags).toContain("#vibecoding");
    expect(tags).toContain("#SaaS");
    expect(tags).not.toContain("#ChatGPT");
  });
});

describe("parseHashtags", () => {
  it("reads the tags out of a fenced reply", () => {
    expect(parseHashtags('```json\n{"hashtags":["#ai","#claude"]}\n```')).toEqual(["#ai", "#claude"]);
  });

  it("returns nothing usable rather than throwing on junk", () => {
    expect(parseHashtags("sorry, I cannot")).toEqual([]);
    expect(parseHashtags("{not json}")).toEqual([]);
  });
});

describe("buildHashtagPrompt", () => {
  it("gives the model the clip's own words and asks for strict JSON", () => {
    const prompt = buildHashtagPrompt({ spokenText: "shipping an agent today", title: "I Shipped an AI Agent" });
    expect(prompt).toContain("shipping an agent today");
    expect(prompt).toContain("I Shipped an AI Agent");
    expect(prompt).toContain('{"hashtags": string[]}');
  });
});
