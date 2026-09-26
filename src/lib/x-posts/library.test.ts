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
      expect(post.text.length, post.topic).toBeLessThanOrEqual(180);
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
});

describe("COLATERAL_LIBRARY", () => {
  it("names CoLateral in both versions, to the same length contract", () => {
    expect(COLATERAL_LIBRARY.length).toBeGreaterThanOrEqual(COLATERAL_POSTS_PER_PACK);
    for (const post of COLATERAL_LIBRARY) {
      expect(post.text, post.topic).toMatch(/CoLateral/);
      expect(post.threadsVariant, post.topic).toMatch(/CoLateral/);
      expect(post.text.length, post.topic).toBeGreaterThanOrEqual(70);
      expect(post.text.length, post.topic).toBeLessThanOrEqual(180);
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
});
