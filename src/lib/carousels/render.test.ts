import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachSlideImages, IMAGE_SLIDE_LAYOUT } from "@/lib/carousels/imageSlides";
import { aspectSpec, renderSlideCanvas } from "@/lib/carousels/render";
import type { CarouselSlide } from "@/types/domain";

/**
 * The photo slide's geometry, checked against a recording 2D context — the
 * whole point of `textBand` is that the copy lands under the photo instead of
 * through the middle of it, and nothing about a plain slide moves.
 */

type Drawn = { text: string; x: number; y: number };
type Painted = { x: number; y: number; w: number; h: number };

const drawnText: Drawn[] = [];
const drawnImages: Painted[] = [];

function recordingContext() {
  const gradient = { addColorStop: () => undefined };
  return {
    canvas: { width: 0, height: 0 },
    font: "",
    fillStyle: "",
    textAlign: "left" as CanvasTextAlign,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect: () => undefined,
    // Roughly proportional, so wrapText splits long copy like a real font would.
    measureText: (text: string) => ({ width: text.length * 24 }),
    fillText: (text: string, x: number, y: number) => drawnText.push({ text, x, y }),
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => drawnImages.push({ x, y, w, h }),
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined
  };
}

beforeEach(() => {
  drawnText.length = 0;
  drawnImages.length = 0;
  Object.assign(globalThis, {
    document: {
      createElement: () => {
        const canvas = { width: 0, height: 0, getContext: () => recordingContext() };
        return canvas;
      }
    },
    Image: class {
      width = 1200;
      height = 800;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "Image");
});

const copy: CarouselSlide = {
  id: "slide-1",
  heading: "The failing test that cost me an hour",
  body: "A caching bug planned the same day twice, so everything posted twice before I caught it."
};

const portrait = aspectSpec("portrait");

describe("photo slide geometry", () => {
  it("paints the photo across the top and keeps every line of copy below it", async () => {
    const [slide] = attachSlideImages([copy], [{ id: "a.png", url: "/api/studio/carousels/images/a.png" }]);
    await renderSlideCanvas(slide, 0, 5, "portrait");

    const photo = drawnImages[0];
    expect(photo.y).toBe(0);
    expect(photo.h).toBeGreaterThanOrEqual(IMAGE_SLIDE_LAYOUT.imageHeight * portrait.height);

    const bandTop = IMAGE_SLIDE_LAYOUT.band.top * portrait.height;
    expect(drawnText.length).toBeGreaterThan(1);
    for (const line of drawnText) expect(line.y).toBeGreaterThan(bandTop);
  });

  it("keeps the copy inside the band rather than running off the bottom", async () => {
    const [slide] = attachSlideImages([copy], [{ id: "a.png", url: "/api/studio/carousels/images/a.png" }]);
    await renderSlideCanvas(slide, 2, 5, "portrait");
    for (const line of drawnText) expect(line.y).toBeLessThan(portrait.height);
  });

  it("leaves a slide without a photo laid out exactly as before", async () => {
    await renderSlideCanvas(copy, 2, 5, "portrait");
    const banded = [...drawnText];
    drawnText.length = 0;
    await renderSlideCanvas({ ...copy, textBand: { top: 0, bottom: 1 } }, 2, 5, "portrait");
    expect(drawnText).toEqual(banded);
  });

  it("centers the copy in the band at every aspect ratio", async () => {
    const [slide] = attachSlideImages([copy], [{ id: "a.png", url: "/api/studio/carousels/images/a.png" }]);
    for (const ratio of ["portrait", "square", "story", "landscape"] as const) {
      drawnText.length = 0;
      await renderSlideCanvas(slide, 1, 5, ratio);
      const spec = aspectSpec(ratio);
      const copyLines = drawnText.filter((line) => !/^\d+\/\d+$/.test(line.text));
      expect(copyLines.length).toBeGreaterThan(0);
      for (const line of copyLines) {
        expect(line.y).toBeGreaterThan(IMAGE_SLIDE_LAYOUT.band.top * spec.height);
        expect(line.y).toBeLessThanOrEqual(spec.height);
      }
    }
  });
});
