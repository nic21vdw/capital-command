import { describe, expect, it } from "vitest";
import { attachSlideBackdrops, attachSlideImages, BACKDROP_SLIDE_LAYOUT, IMAGE_SLIDE_LAYOUT } from "@/lib/carousels/imageSlides";
import type { CarouselSlide } from "@/types/domain";

function deck(count: number): CarouselSlide[] {
  return Array.from({ length: count }, (_, i) => ({ id: `slide-${i}`, heading: `Heading ${i}`, body: `Body ${i}` }));
}

const photos = [
  { id: "a.png", url: "/api/studio/carousels/images/a.png" },
  { id: "b.jpg", url: "/api/studio/carousels/images/b.jpg" }
];

describe("attachSlideImages", () => {
  it("puts one photo on each slide, in upload order", () => {
    const slides = attachSlideImages(deck(4), photos);
    expect(slides[0].layers?.[0]).toMatchObject({ type: "image", src: photos[0].url });
    expect(slides[1].layers?.[0]).toMatchObject({ type: "image", src: photos[1].url });
    // Never two to a slide, and never the same photo twice.
    expect(slides.flatMap((slide) => slide.layers ?? []).length).toBe(2);
  });

  it("leaves the copy in heading/body so it still wraps at every aspect ratio", () => {
    const [first] = attachSlideImages(deck(2), photos);
    expect(first.heading).toBe("Heading 0");
    expect(first.hideBaseText).toBeUndefined();
    expect(first.textBand).toEqual(IMAGE_SLIDE_LAYOUT.band);
  });

  it("keeps the photo clear of the copy band", () => {
    const [first] = attachSlideImages(deck(1), photos);
    const layer = first.layers?.[0];
    expect(layer?.type === "image" && layer.height).toBeLessThanOrEqual(IMAGE_SLIDE_LAYOUT.band.top);
  });

  it("leaves slides past the last photo as plain copy slides", () => {
    const slides = attachSlideImages(deck(5), photos);
    expect(slides[2].layers).toBeUndefined();
    expect(slides[2].textBand).toBeUndefined();
  });

  it("keeps layers a slide already had, under nothing it did not ask for", () => {
    const existing: CarouselSlide = {
      id: "slide-x",
      heading: "",
      body: "",
      layers: [{ id: "text-1", type: "text", text: "hi", x: 0.1, y: 0.1, width: 0.5, fontSize: 0.05, color: "#fff", weight: 700, align: "left" }]
    };
    const [slide] = attachSlideImages([existing], photos);
    expect(slide.layers).toHaveLength(2);
    expect(slide.layers?.[1].id).toBe("text-1");
  });
});

describe("attachSlideBackdrops", () => {
  it("leaves a slide plain where its still was rejected, without shifting the rest", () => {
    const images = [{ id: "a", url: "/a" }, null, { id: "c", url: "/c" }];
    const slides = attachSlideBackdrops(deck(3), images);
    const source = (index: number) => {
      const layer = slides[index].layers?.[0];
      return layer && layer.type === "image" ? layer.src : null;
    };
    expect(source(0)).toBe("/a");
    expect(slides[1].layers ?? []).toHaveLength(0);
    expect(source(2)).toBe("/c");
  });

  it("lays each still behind the whole slide, in order", () => {
    const slides = attachSlideBackdrops(deck(3), photos);
    expect(slides[0].layers?.[0]).toMatchObject({ type: "image", src: photos[0].url, x: 0, y: 0, width: 1, height: 1, fit: "cover" });
    expect(slides[1].layers?.[0]).toMatchObject({ type: "image", src: photos[1].url });
    expect(slides[2].layers).toBeUndefined();
  });

  it("veils the still and sets the copy light so it reads over any frame", () => {
    const [first] = attachSlideBackdrops(deck(1), photos);
    expect(first.scrim).toBe(BACKDROP_SLIDE_LAYOUT.scrim);
    expect(first.headingColor).toBe(BACKDROP_SLIDE_LAYOUT.headingColor);
    expect(first.bodyColor).toBe(BACKDROP_SLIDE_LAYOUT.bodyColor);
    expect(first.textBand).toEqual(BACKDROP_SLIDE_LAYOUT.band);
  });

  it("leaves colours chosen in the editor alone", () => {
    const edited = [{ id: "s", heading: "H", body: "B", headingColor: "#ff0000" }];
    expect(attachSlideBackdrops(edited, photos)[0].headingColor).toBe("#ff0000");
  });

  it("keeps the copy in heading/body so it wraps at every aspect ratio", () => {
    const [first] = attachSlideBackdrops(deck(1), photos);
    expect(first.heading).toBe("Heading 0");
    expect(first.hideBaseText).toBeUndefined();
  });
});
