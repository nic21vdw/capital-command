import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deckDir } from "@/lib/carousels/deckFiles";
import { aspectSpec } from "@/lib/carousels/render";
import { renderCarouselDeck } from "@/lib/carousels/renderDeck";
import { readImageSize } from "@/lib/podcast/artwork";
import type { Carousel } from "@/types/domain";

/**
 * The half that could not be checked by geometry alone: real PNG files, at the
 * deck's frame, that a picture post can actually be booked from.
 */

const deck = (id: string, headings: string[]): Carousel => ({
  id,
  title: "What one stream produces",
  sourceType: "longform",
  aspectRatio: "portrait",
  slides: headings.map((heading, index) => ({
    id: `slide-${index}`,
    heading,
    body: "A caching bug planned the same day twice, so everything posted twice before I caught it."
  })),
  createdAt: "2026-08-06T12:00:00.000Z"
});

describe("rendering a stored deck", () => {
  it("writes one real PNG per slide at the deck's frame", async () => {
    const carousel = deck("deck-a", ["The failing test that cost me an hour", "What I changed"]);
    const files = await renderCarouselDeck(carousel);

    expect(files).toHaveLength(2);
    expect(files[0]).toBe(path.join(deckDir("deck-a"), "slide-01.png"));

    const portrait = aspectSpec("portrait");
    for (const file of files) {
      const bytes = await readFile(file);
      expect(bytes.byteLength).toBeGreaterThan(5_000);
      expect(readImageSize(bytes)).toEqual({ width: portrait.width, height: portrait.height, format: "png" });
    }
  });

  it("leaves the files it already painted alone", async () => {
    const carousel = deck("deck-b", ["One", "Two"]);
    const [first] = await renderCarouselDeck(carousel);
    const painted = await stat(first);

    const again = await renderCarouselDeck(carousel);
    expect(again[0]).toBe(first);
    expect((await stat(first)).mtimeMs).toBe(painted.mtimeMs);
  });

  it("repaints a slide that was edited and forgets one that was dropped", async () => {
    const carousel = deck("deck-c", ["One", "Two"]);
    const [first, second] = await renderCarouselDeck(carousel);
    const untouched = await stat(first);
    const before = await readFile(second);

    const edited: Carousel = {
      ...carousel,
      slides: [carousel.slides[0], { ...carousel.slides[1], heading: "Something else entirely" }]
    };
    await renderCarouselDeck(edited);
    expect((await stat(first)).mtimeMs).toBe(untouched.mtimeMs);
    expect(await readFile(second)).not.toEqual(before);

    const shorter = await renderCarouselDeck({ ...carousel, slides: [carousel.slides[0]] });
    expect(shorter).toHaveLength(1);
    await expect(stat(second)).rejects.toThrow();
  });

  it("has nothing to write for a deck with no slides", async () => {
    expect(await renderCarouselDeck({ ...deck("deck-d", []), slides: [] })).toEqual([]);
  });
});
