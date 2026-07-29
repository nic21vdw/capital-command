import { describe, expect, it } from "vitest";
import { MAX_TAGLINE_CHARS, buildLaunchCopyPrompt, fallbackLaunchCopy, parseLaunchCopy } from "@/lib/launch/copy";

const input = {
  product: "CoLateral",
  productUrl: "https://colateral.ai",
  audience: "structural engineers",
  whatItDoes: "turns a set of drawings into a checked design package",
  differentiator: "it is built by a practising structural engineer"
};

function reply(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    tagline: "An AI workspace for structural engineers",
    description: "CoLateral turns drawings into a checked design package. Built for engineers who bill by the hour.",
    firstComment: "Hey Product Hunt — I built this because I do this work every day. What slows you down most?",
    topics: ["Artificial Intelligence", "Productivity", "Engineering"],
    galleryCaptions: ["The problem", "The fix", "On real work", "The checks", "What is next"],
    socialPosts: [
      { surface: "x", text: "CoLateral is live." },
      { surface: "threads", text: "Shipped it." }
    ],
    ...overrides
  });
}

describe("launch copy prompt", () => {
  it("passes every answer through and states the tagline limit", () => {
    const prompt = buildLaunchCopyPrompt(input);
    expect(prompt).toContain("CoLateral");
    expect(prompt).toContain("structural engineers");
    expect(prompt).toContain("checked design package");
    expect(prompt).toContain("practising structural engineer");
    expect(prompt).toContain(String(MAX_TAGLINE_CHARS));
  });

  it("marks missing answers rather than leaving a blank line", () => {
    const prompt = buildLaunchCopyPrompt({ ...input, audience: "", differentiator: "" });
    expect(prompt).toContain("Who it is for: (not given)");
    expect(prompt).toContain("Why it is different: (not given)");
  });
});

describe("parseLaunchCopy", () => {
  it("reads a fenced JSON reply", () => {
    const parsed = parseLaunchCopy("Here you go:\n```json\n" + reply() + "\n```");
    expect(parsed?.tagline).toBe("An AI workspace for structural engineers");
    expect(parsed?.topics).toHaveLength(3);
    expect(parsed?.socialPosts.map((post) => post.surface)).toEqual(["x", "threads"]);
  });

  it("reads a bare JSON reply wrapped in prose", () => {
    expect(parseLaunchCopy(`Sure thing. ${reply()} Hope that helps.`)?.firstComment).toContain("Hey Product Hunt");
  });

  it("truncates an over-long tagline to the Product Hunt limit", () => {
    const parsed = parseLaunchCopy(reply({ tagline: "x".repeat(120) }));
    expect(parsed?.tagline).toHaveLength(MAX_TAGLINE_CHARS);
  });

  it("caps the list fields", () => {
    const parsed = parseLaunchCopy(
      reply({ topics: ["a", "b", "c", "d", "e"], galleryCaptions: Array.from({ length: 12 }, (_, i) => `c${i}`) })
    );
    expect(parsed?.topics).toHaveLength(3);
    expect(parsed?.galleryCaptions).toHaveLength(6);
  });

  it("drops malformed social posts instead of the whole reply", () => {
    const parsed = parseLaunchCopy(reply({ socialPosts: [{ surface: "x", text: "ok" }, { surface: "threads" }, "nope"] }));
    expect(parsed?.socialPosts).toEqual([{ surface: "x", text: "ok" }]);
  });

  it("rejects a reply missing any of the three required fields", () => {
    expect(parseLaunchCopy(reply({ tagline: "" }))).toBeNull();
    expect(parseLaunchCopy(reply({ description: "   " }))).toBeNull();
    expect(parseLaunchCopy(reply({ firstComment: undefined }))).toBeNull();
    expect(parseLaunchCopy("not json at all")).toBeNull();
  });
});

describe("fallbackLaunchCopy", () => {
  it("produces an editable draft that respects the tagline limit", () => {
    const copy = fallbackLaunchCopy(input);
    expect(copy.aiGenerated).toBe(false);
    expect(copy.tagline.length).toBeLessThanOrEqual(MAX_TAGLINE_CHARS);
    expect(copy.firstComment).toContain("CoLateral");
    expect(copy.socialPosts.map((post) => post.surface)).toEqual(["x", "threads", "linkedin", "youtube-community"]);
  });

  it("still fills in when only the product name is known", () => {
    const copy = fallbackLaunchCopy({ product: "CoLateral", productUrl: "", audience: "", whatItDoes: "", differentiator: "" });
    expect(copy.tagline).toContain("CoLateral");
    expect(copy.description.trim()).not.toBe("");
    expect(copy.galleryCaptions).toHaveLength(5);
  });
});
