import { describe, expect, it } from "vitest";
import { humanize, sprinkleTypo, stripDashes } from "@/lib/x-posts/voice";

/**
 * The dash removal has to be total, because it is the whole reason the pass
 * exists — a single em dash in a day of posts is the tell. The typo pass has to
 * be the opposite: rare, mild, and incapable of touching a handle or a link.
 */

describe("stripDashes", () => {
  it("turns a punctuation dash into a comma", () => {
    expect(stripDashes("It's not about speed — it's about judgment.")).toBe(
      "It's not about speed, it's about judgment."
    );
  });

  it("handles a paired parenthetical without doubling punctuation", () => {
    expect(stripDashes("They do one workflow completely — intake to sign-off — instead of ten.")).toBe(
      "They do one workflow completely, intake to sign-off, instead of ten."
    );
  });

  it("keeps ranges readable", () => {
    expect(stripDashes("It took 10–20 minutes.")).toBe("It took 10-20 minutes.");
  });

  it("keeps the hyphens that belong to words", () => {
    expect(stripDashes("sign-off on a well-known build-in-public post")).toBe(
      "sign-off on a well-known build-in-public post"
    );
  });

  it("preserves line breaks instead of collapsing the post into a paragraph", () => {
    const post = "One thing I got wrong — the timeline.\n\nSecond line — still wrong.";
    const out = stripDashes(post);
    expect(out).toBe("One thing I got wrong, the timeline.\n\nSecond line, still wrong.");
    expect(out.split("\n\n")).toHaveLength(2);
  });

  it("reads a dash opening a line as a bullet", () => {
    expect(stripDashes("What shipped:\n— faster exports\n— fewer retries")).toBe(
      "What shipped:\n- faster exports\n- fewer retries"
    );
  });

  it("never leaves a dash behind, whatever the spacing", () => {
    for (const post of ["a—b", "a — b", "a–b", "a  —  b", "end —", "— start"]) {
      expect(stripDashes(post)).not.toMatch(/[—–]/);
    }
  });

  it("is idempotent, so running it again at queue time changes nothing", () => {
    const once = stripDashes("Shipping is a skill — taste is the other one.");
    expect(stripDashes(once)).toBe(once);
  });
});

describe("sprinkleTypo", () => {
  it("leaves the overwhelming majority of posts untouched", () => {
    const posts = Array.from({ length: 200 }, (_, index) => ({
      seed: `2026-08-01:${index}`,
      text: "You're shipping faster than you can verify. That's the whole problem."
    }));
    const changed = posts.filter((post) => sprinkleTypo(post.text, post.seed, 0.08) !== post.text);
    // Rare means rare: a handful in two hundred, not a feed full of mistakes.
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(30);
  });

  it("makes at most one slip, and only a dropped apostrophe", () => {
    const text = "You're shipping faster than you can verify. That's the problem. It's not close.";
    const slipped = Array.from({ length: 400 }, (_, i) => sprinkleTypo(text, `s${i}`, 1)).filter((t) => t !== text);
    expect(slipped.length).toBeGreaterThan(0);
    for (const out of slipped) {
      // Lowercased, because a slip on a sentence-opening "You're" reads "Youre"
      // — the capitalisation of the original is deliberately preserved.
      const lower = out.toLowerCase();
      const missing = ["youre", "thats", "its"].filter((word) => lower.includes(word));
      expect(missing).toHaveLength(1);
      expect(out.length).toBe(text.length - 1);
    }
  });

  it("never edits a handle, a hashtag or a link", () => {
    const text = "that's the point, ask @don't.ship or see https://example.com/don't";
    for (let i = 0; i < 200; i += 1) {
      const out = sprinkleTypo(text, `h${i}`, 1);
      expect(out).toContain("@don't.ship");
      expect(out).toContain("https://example.com/don't");
    }
  });

  it("is stable for a given post, so a replan does not rewrite it", () => {
    const text = "That's the part nobody measures.";
    expect(sprinkleTypo(text, "fixed", 1)).toBe(sprinkleTypo(text, "fixed", 1));
  });

  it("is switched off entirely at rate 0", () => {
    const text = "That's the part nobody measures.";
    for (let i = 0; i < 50; i += 1) expect(sprinkleTypo(text, `z${i}`, 0)).toBe(text);
  });
});

describe("humanize", () => {
  it("always removes the dash, whether or not it leaves a slip", () => {
    for (let i = 0; i < 100; i += 1) {
      const out = humanize("Verification is the bottleneck — not generation.", `seed${i}`, { typoRate: 1 });
      expect(out).not.toMatch(/[—–]/);
    }
  });
});
