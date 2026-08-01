import { describe, expect, it } from "vitest";
import {
  buildPlatformCopyPrompt,
  fallbackPlatformCopy,
  normalizeHashtags,
  parsePlatformCopy
} from "@/lib/publisher/ai-copy";

describe("normalizeHashtags", () => {
  it("adds a #, strips junk, dedupes case-insensitively and caps the count", () => {
    const tags = normalizeHashtags(["AI", "#ai", "vibe coding!", "AI", "coding", "startup", "tech"], 4);
    expect(tags).toEqual(["#AI", "#vibecoding", "#coding", "#startup"]);
  });
});

describe("buildPlatformCopyPrompt", () => {
  it("names the platform, includes the platform guide, timezone, and clip context", () => {
    const prompt = buildPlatformCopyPrompt(
      { title: "Vibe Coding a SaaS", topic: "AI agents", spokenText: "here is how I did it" },
      "tiktok",
      "America/Toronto"
    );
    expect(prompt).toContain("TIKTOK");
    expect(prompt).toContain("TikTok:");
    expect(prompt).toContain("America/Toronto");
    expect(prompt).toContain("Vibe Coding a SaaS");
    expect(prompt).toContain("here is how I did it");
  });
});

describe("parsePlatformCopy", () => {
  it("reads a fenced JSON object with caption, hashtags and a padded best time", () => {
    const text =
      '```json\n{"caption":"Native TikTok hook","hashtags":["#ai","#coding"],"bestTime":"9:30","note":"morning"}\n```';
    const copy = parsePlatformCopy(text);
    expect(copy).toMatchObject({
      caption: "Native TikTok hook",
      hashtags: ["#ai", "#coding"],
      bestTime: "09:30",
      note: "morning"
    });
  });

  it("rejects a reply with no caption and ignores a malformed best time", () => {
    expect(parsePlatformCopy("not json")).toBeNull();
    expect(parsePlatformCopy('{"caption":"","hashtags":[]}')).toBeNull();
    expect(parsePlatformCopy('{"caption":"hi","bestTime":"nope"}')?.bestTime).toBeUndefined();
  });
});

describe("fallbackPlatformCopy", () => {
  it("builds a usable caption + hashtags from the title", () => {
    const copy = fallbackPlatformCopy({ title: "My Clip" }, "facebook");
    expect(copy.caption).toBe("My Clip");
    expect(copy.hashtags.length).toBeGreaterThan(0);
    expect(copy.hashtags.every((tag) => tag.startsWith("#"))).toBe(true);
  });
});
