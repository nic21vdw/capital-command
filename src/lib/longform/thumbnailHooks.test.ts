import { describe, expect, it } from "vitest";
import { fallbackHooks, parseHooks } from "@/lib/longform/thumbnailHooks";

describe("parseHooks", () => {
  it("reads the array out of a reply that wraps it in prose", () => {
    const text = 'Sure! Here you go:\n["i started a *fake* beef", "fake drama is free *marketing*"]\nHope that helps.';
    expect(parseHooks(text)).toEqual(["i started a *fake* beef", "fake drama is free *marketing*"]);
  });

  it("clamps a rambling line to six words", () => {
    expect(parseHooks('["one two three four five six seven eight"]')).toEqual(["one two three four five six"]);
  });

  it("drops duplicates and keeps at most three", () => {
    expect(parseHooks('["a b", "a b", "c d", "e f", "g h"]')).toEqual(["a b", "c d", "e f"]);
  });

  it("returns nothing for a reply with no array, bad JSON, or no reply at all", () => {
    expect(parseHooks("I could not do that.")).toEqual([]);
    expect(parseHooks("[not json]")).toEqual([]);
    expect(parseHooks(undefined)).toEqual([]);
    expect(parseHooks(null)).toEqual([]);
  });

  it("ignores non-string entries", () => {
    expect(parseHooks('["real one", 7, null, {"a":1}]')).toEqual(["real one"]);
  });
});

describe("fallbackHooks", () => {
  it("writes short lowercase lines from the title when the model is unreachable", () => {
    const hooks = fallbackHooks("Fake Beef With Nick and the Vibe Coding Drama");
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks.length).toBeLessThanOrEqual(3);
    for (const hook of hooks) {
      expect(hook).toBe(hook.toLowerCase());
      expect(hook.split(/\s+/).length).toBeLessThanOrEqual(6);
    }
  });

  it("has nothing to say about an empty title", () => {
    expect(fallbackHooks("   ")).toEqual([]);
  });
});
