import { describe, expect, it, vi } from "vitest";
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
    expect(prompt).toContain("desktop agentic workspace");
    expect(prompt).toContain("developers, creators and engineers");
    for (const line of prompt.split("\n").filter((row) => /structural/i.test(row))) expect(line).toMatch(/^- Never /);
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

describe("generatePlatformCopy source", () => {
  it("marks the title fallback so the screen cannot call it tailored copy", async () => {
    vi.resetModules();
    vi.doMock("@/lib/ai", () => ({ aiConfigured: () => false, runAi: vi.fn() }));
    const { generatePlatformCopy } = await import("@/lib/publisher/ai-copy");
    const copy = await generatePlatformCopy({ title: "My Clip" }, "youtube");
    expect(copy.source).toBe("fallback");
    expect(copy.caption).toBe("My Clip");
    vi.doUnmock("@/lib/ai");
  });

  it("marks a model-written caption as ai", async () => {
    vi.resetModules();
    vi.doMock("@/lib/ai", () => ({
      aiConfigured: () => true,
      runAi: vi.fn(async () => ({ text: '{"caption":"Written","hashtags":["#ai"]}', refused: false }))
    }));
    const { generatePlatformCopy } = await import("@/lib/publisher/ai-copy");
    const copy = await generatePlatformCopy({ title: "My Clip" }, "youtube");
    expect(copy.source).toBe("ai");
    expect(copy.caption).toBe("Written");
    vi.doUnmock("@/lib/ai");
  });

  it("falls back, and says so, when the model refuses", async () => {
    vi.resetModules();
    vi.doMock("@/lib/ai", () => ({
      aiConfigured: () => true,
      runAi: vi.fn(async () => ({ text: "", refused: true }))
    }));
    const { generatePlatformCopy } = await import("@/lib/publisher/ai-copy");
    expect((await generatePlatformCopy({ title: "T" }, "tiktok")).source).toBe("fallback");
    vi.doUnmock("@/lib/ai");
  });
});
