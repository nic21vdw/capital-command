import { describe, expect, it } from "vitest";
import { COLATERAL_LIBRARY, POST_LIBRARY, REPLY_LIBRARY } from "@/lib/x-posts/library";
import { COLATERAL_POSTS_PER_PACK, POSTS_PER_PACK, REPLIES_PER_PACK, libraryPack } from "@/lib/x-posts/generator";

/**
 * The fallback pack has to obey the same two-version contract the generator
 * prompts for, because a connected account posts the warm version and a second
 * one posts the punchy version. A variant that merely pads its twin puts near
 * identical wording on both feeds, which is the whole failure the pair exists
 * to prevent — and a fallback day is exactly when nobody is watching.
 */

describe("POST_LIBRARY", () => {
  it("has enough entries to fill a pack", () => {
    expect(POST_LIBRARY.length).toBeGreaterThanOrEqual(POSTS_PER_PACK);
    expect(REPLY_LIBRARY.length).toBeGreaterThanOrEqual(REPLIES_PER_PACK);
  });

  it("keeps the short version short", () => {
    for (const post of POST_LIBRARY) {
      expect(post.text.length, post.topic).toBeGreaterThanOrEqual(70);
      expect(post.text.length, post.topic).toBeLessThanOrEqual(150);
    }
  });

  it("gives the second version one more beat, not a paragraph", () => {
    for (const post of POST_LIBRARY) {
      expect(post.threadsVariant.length, post.topic).toBeGreaterThanOrEqual(180);
      expect(post.threadsVariant.length, post.topic).toBeLessThanOrEqual(280);
    }
  });

  it("makes the longer version clearly longer than the short one", () => {
    for (const post of POST_LIBRARY) {
      expect(post.threadsVariant.length - post.text.length, post.topic).toBeGreaterThan(50);
    }
  });

  it("rewords rather than pads — the two never share an opening", () => {
    const shared = POST_LIBRARY.filter((post) => post.threadsVariant.includes(post.text.slice(0, 40)));
    expect(shared.map((post) => post.topic)).toEqual([]);
  });
});

describe("libraryPack", () => {
  it("builds a complete pack without the network", () => {
    const pack = libraryPack("2026-07-29", "");

    expect(pack.source).toBe("library");
    expect(pack.posts).toHaveLength(POSTS_PER_PACK);
    expect(pack.replies).toHaveLength(REPLIES_PER_PACK);
    for (const post of pack.posts) {
      expect(post.threadsVariant.length).toBeGreaterThan(post.text.length);
    }
  });

  it("rotates distinct angles while keeping the same daily rhythm and brand mix", () => {
    const first = libraryPack("2026-10-02", "");
    const next = libraryPack("2026-10-03", "");
    expect(new Set(first.posts.map((post) => post.topic)).size).toBe(POSTS_PER_PACK);
    expect(new Set(next.posts.map((post) => post.topic)).size).toBe(POSTS_PER_PACK);
    expect(next.posts.map((post) => post.topic)).not.toEqual(first.posts.map((post) => post.topic));
    const firstBrands = first.posts.filter((post) => /CoLateral/.test(post.text)).map((post) => post.topic);
    const nextBrands = next.posts.filter((post) => /CoLateral/.test(post.text)).map((post) => post.topic);
    expect(nextBrands.some((topic) => !firstBrands.includes(topic))).toBe(true);
    expect(nextBrands).toHaveLength(COLATERAL_POSTS_PER_PACK);
    expect(new Set(first.posts.map((post) => post.format)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("COLATERAL_LIBRARY", () => {
  it("names CoLateral in both versions, to the same length contract", () => {
    expect(COLATERAL_LIBRARY.length).toBeGreaterThanOrEqual(COLATERAL_POSTS_PER_PACK);
    for (const post of COLATERAL_LIBRARY) {
      expect(post.text, post.topic).toMatch(/CoLateral/);
      expect(post.threadsVariant, post.topic).toMatch(/CoLateral/);
      expect(post.text.length, post.topic).toBeGreaterThanOrEqual(70);
      expect(post.text.length, post.topic).toBeLessThanOrEqual(150);
      expect(post.threadsVariant.length, post.topic).toBeGreaterThanOrEqual(180);
      expect(post.threadsVariant.length, post.topic).toBeLessThanOrEqual(280);
    }
  });

  it("puts a CoLateral post in every third slot of a fallback pack", () => {
    const pack = libraryPack("2026-07-29", "");
    const colateral = pack.posts.filter((post) => /CoLateral/.test(post.text));

    expect(colateral).toHaveLength(COLATERAL_POSTS_PER_PACK);
    expect(colateral.map((post) => post.slot)).toEqual([3, 6, 9, 12, 15, 18, 21, 24]);
  });

  it("offers different audiences a concrete reason to care without claiming new releases", () => {
    const copy = COLATERAL_LIBRARY.map((post) => `${post.text} ${post.threadsVariant}`).join("\n");
    expect(copy).toMatch(/file.*clean|clean.*file/);
    expect(copy).toMatch(/creators/);
    expect(copy).toMatch(/engineers/);
    expect(copy).toMatch(/game/);
    expect(copy).toMatch(/calculator/);
    expect(copy).toMatch(/Claude Code and Codex/);
    expect(copy).not.toMatch(
      /you can now|just launched|fixed.*today|saves.*hours|\$\d|guaranteed compliance|automatically approves/i
    );
  });
});

describe("offline editorial safety", () => {
  it("keeps parent posts and evergreen replies useful without links or decorative promotion", () => {
    const copy = [
      ...POST_LIBRARY.flatMap((post) => [post.text, post.threadsVariant]),
      ...COLATERAL_LIBRARY.flatMap((post) => [post.text, post.threadsVariant]),
      ...REPLY_LIBRARY.map((reply) => reply.text)
    ];
    for (const text of copy) {
      expect(text).not.toMatch(
        /https?:\/\/|colateralai\.com|www\.|[—–]|Capital Command|#\w|\p{Extended_Pictographic}/u
      );
      expect(text).not.toMatch(/check out|sign up|link below|read the reply/i);
    }
  });

  it("does not invent dated anecdotes or measurable results when no current facts are available", () => {
    const copy = [...POST_LIBRARY, ...COLATERAL_LIBRARY].flatMap((post) => [post.text, post.threadsVariant]).join("\n");
    expect(copy).not.toMatch(
      /(?:yesterday|this morning|last week|this week|same afternoon|\d+\s+(?:terminals|users|sales|hours))/i
    );
  });
});
