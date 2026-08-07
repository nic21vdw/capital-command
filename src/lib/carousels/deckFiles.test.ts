import { describe, expect, it } from "vitest";
import { planDeckRender, slideFileName, slideFingerprint, type DeckManifest } from "@/lib/carousels/deckFiles";
import type { CarouselSlide } from "@/types/domain";

const slide = (id: string, heading: string): CarouselSlide => ({ id, heading, body: `${heading} body` });

const deck = (headings: string[]) => ({
  slides: headings.map((heading, index) => slide(`s${index}`, heading)),
  aspectRatio: "portrait" as const
});

function manifestFor(carousel: ReturnType<typeof deck>): DeckManifest {
  return planDeckRender(carousel, null, []).manifest;
}

describe("slide fingerprints", () => {
  it("moves when the copy does", () => {
    const base = { index: 0, total: 3, ratio: "portrait" as const };
    expect(slideFingerprint({ ...base, slide: slide("a", "one") })).not.toBe(
      slideFingerprint({ ...base, slide: slide("a", "two") })
    );
  });

  it("moves when the slide's place in the deck does — the counter is drawn on it", () => {
    const base = { slide: slide("a", "one"), total: 3, ratio: "portrait" as const };
    expect(slideFingerprint({ ...base, index: 0 })).not.toBe(slideFingerprint({ ...base, index: 1 }));
    expect(slideFingerprint({ ...base, index: 0, total: 4 })).not.toBe(slideFingerprint({ ...base, index: 0 }));
  });

  it("ignores the order the slide's own keys happen to be written in", () => {
    const base = { index: 0, total: 2, ratio: "portrait" as const };
    const one: CarouselSlide = { id: "a", heading: "h", body: "b", scrim: 0.5 };
    const other = { scrim: 0.5, body: "b", heading: "h", id: "a" } as CarouselSlide;
    expect(slideFingerprint({ ...base, slide: one })).toBe(slideFingerprint({ ...base, slide: other }));
  });
});

describe("planning a deck render", () => {
  it("paints every slide the first time", () => {
    const plan = planDeckRender(deck(["one", "two", "three"]), null, []);
    expect(plan.render).toEqual([0, 1, 2]);
    expect(plan.files).toEqual([slideFileName(0), slideFileName(1), slideFileName(2)]);
  });

  it("paints nothing the second time", () => {
    const carousel = deck(["one", "two"]);
    const first = planDeckRender(carousel, null, []);
    const second = planDeckRender(carousel, first.manifest, first.files);
    expect(second.render).toEqual([]);
    expect(second.stale).toEqual([]);
  });

  it("repaints only the slide that was edited", () => {
    const carousel = deck(["one", "two", "three"]);
    const manifest = manifestFor(carousel);
    const files = manifest.slides.map((entry) => entry.file);
    const edited = deck(["one", "rewritten", "three"]);
    expect(planDeckRender(edited, manifest, files).render).toEqual([1]);
  });

  it("repaints a slide whose file has gone missing", () => {
    const carousel = deck(["one", "two"]);
    const manifest = manifestFor(carousel);
    expect(planDeckRender(carousel, manifest, [slideFileName(0)]).render).toEqual([1]);
  });

  it("repaints the whole deck when the frame changes", () => {
    const carousel = deck(["one", "two"]);
    const manifest = manifestFor(carousel);
    const files = manifest.slides.map((entry) => entry.file);
    const story = { ...carousel, aspectRatio: "story" as const };
    expect(planDeckRender(story, manifest, files).render).toEqual([0, 1]);
  });

  it("clears the leftovers of a deck that got shorter, keeping the manifest", () => {
    const long = deck(["one", "two", "three"]);
    const files = [...manifestFor(long).slides.map((entry) => entry.file), "slides.json"];
    const plan = planDeckRender(deck(["one", "two"]), manifestFor(long), files);
    expect(plan.stale).toEqual([slideFileName(2)]);
    expect(plan.files).toHaveLength(2);
  });
});
