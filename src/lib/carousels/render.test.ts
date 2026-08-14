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
    fill: () => undefined,
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
    // Everything except the slide counter, which deliberately rides the photo.
    const copyLines = drawnText.filter((line) => !/^\d+\/\d+$/.test(line.text));
    expect(copyLines.length).toBeGreaterThan(1);
    for (const line of copyLines) expect(line.y).toBeGreaterThan(bandTop);
  });

  it("keeps the copy inside the band rather than running off the bottom", async () => {
    const [slide] = attachSlideImages([copy], [{ id: "a.png", url: "/api/studio/carousels/images/a.png" }]);
    await renderSlideCanvas(slide, 2, 5, "portrait");
    for (const line of drawnText) expect(line.y).toBeLessThan(portrait.height);
  });

  it("keeps the counter out of the copy, over the photo instead", async () => {
    const [slide] = attachSlideImages([copy], [{ id: "a.png", url: "/api/studio/carousels/images/a.png" }]);
    await renderSlideCanvas(slide, 0, 8, "portrait");
    const counter = drawnText.find((line) => line.text === "1/8");
    const copyLines = drawnText.filter((line) => line !== counter);
    expect(counter).toBeDefined();
    // Up on the photo, well above the first line of copy.
    expect(counter!.y).toBeLessThan(Math.min(...copyLines.map((line) => line.y)));
    expect(counter!.y).toBeLessThan(IMAGE_SLIDE_LAYOUT.imageHeight * portrait.height);
  });

  it("paints the photo at a thumbnail render too, scaled to the smaller canvas", async () => {
    const [slide] = attachSlideImages([copy], [{ id: "a.png", url: "/api/studio/carousels/images/a.png" }]);
    const canvas = await renderSlideCanvas(slide, 0, 5, "portrait", { width: 416 });

    expect(canvas.width).toBe(416);
    expect(canvas.height).toBe(Math.round((416 * portrait.height) / portrait.width));
    const photo = drawnImages[0];
    expect(photo).toBeDefined();
    // Same picture, not a different layout — the photo still claims the top
    // band, measured against the smaller canvas.
    expect(photo.y).toBe(0);
    expect(photo.h).toBeGreaterThanOrEqual(IMAGE_SLIDE_LAYOUT.imageHeight * canvas.height);
    expect(photo.h).toBeLessThan(portrait.height * IMAGE_SLIDE_LAYOUT.imageHeight);
  });

  it("leaves a slide without a photo laid out as it always was", async () => {
    await renderSlideCanvas(copy, 2, 5, "portrait");
    const counter = drawnText.find((line) => line.text === "3/5");
    // Top-right of the slide, in the channel's plain counter position.
    expect(counter?.y).toBe(100);
    const copyLines = drawnText.filter((line) => line !== counter);
    // Centered on the whole slide, not pushed into a band.
    expect(Math.min(...copyLines.map((line) => line.y))).toBeLessThan(portrait.height / 2);
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

/**
 * Emoji are the one thing on a slide that is not drawn with the slide's font.
 * The server has no emoji font at all, so a glyph left to `fillText` there is
 * simply absent — these check that the copy is cut into pieces and the picture
 * is drawn in the gap.
 */
describe("emoji in slide copy", () => {
  const withEmoji: CarouselSlide = {
    id: "slide-emoji",
    heading: "🚀 Ship it",
    body: "Momentum beats planning 🔥"
  };

  it("draws each emoji as a picture and never as text", async () => {
    await renderSlideCanvas(withEmoji, 0, 4, "portrait");
    expect(drawnText.map((line) => line.text).join(" ")).not.toMatch(/[🚀🔥]/u);
    // One per glyph, square, and sized off the line it sits on.
    expect(drawnImages).toHaveLength(2);
    for (const picture of drawnImages) expect(picture.w).toBeCloseTo(picture.h, 5);
    const [heading, body] = drawnImages;
    expect(heading.w).toBeGreaterThan(body.w);
  });

  it("keeps the words either side of the emoji", async () => {
    await renderSlideCanvas(withEmoji, 0, 4, "portrait");
    const copyLines = drawnText.filter((line) => !/^\d+\/\d+$/.test(line.text));
    expect(copyLines.map((line) => line.text).join("")).toContain("Ship it");
    expect(copyLines.map((line) => line.text).join("")).toContain("Momentum beats planning");
  });

  it("starts the picture where the text before it ended", async () => {
    await renderSlideCanvas({ id: "s", heading: "Go 🚀", body: "" }, 0, 4, "portrait");
    const [picture] = drawnImages;
    const before = drawnText.find((line) => line.text.startsWith("Go"))!;
    // measureText in this stub is 24px a character, and "Go " is three.
    expect(picture.x).toBeCloseTo(before.x + 3 * 24, 5);
  });

  it("leaves the line's other pictures alone when one cannot be fetched", async () => {
    Object.assign(globalThis, {
      Image: class {
        width = 64;
        height = 64;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          setTimeout(() => this.onerror?.(), 0);
        }
      }
    });
    await renderSlideCanvas({ id: "s", heading: "Growth 📈", body: "" }, 0, 4, "portrait");
    expect(drawnImages).toHaveLength(0);
    // Falls back to writing the glyph rather than dropping the word with it.
    expect(drawnText.some((line) => line.text === "📈")).toBe(true);
    expect(drawnText.some((line) => line.text.includes("Growth"))).toBe(true);
  });
});

/**
 * A still from a stream is the whole frame or it is not worth having: the face
 * and the editor and the terminal are all in shot together, and cropping to the
 * slide's shape is what threw the face away.
 */
describe("a framed still", () => {
  const framed: CarouselSlide = {
    id: "framed",
    heading: "Whole frame",
    body: "",
    scrim: 0.52,
    textBand: { top: 0.6, bottom: 0.88 },
    layers: [{ id: "l", type: "image", src: "/frame.jpg", x: 0, y: 0, width: 1, height: 1, fit: "frame" }]
  };

  it("draws the whole picture, and a bed behind it that does fill the slide", async () => {
    await renderSlideCanvas(framed, 0, 6, "portrait");
    expect(drawnImages).toHaveLength(2);
    const [bed, picture] = drawnImages;
    // The stub image is 1200x800; contained in 1080 wide that is 1080x720.
    expect(picture.w).toBeCloseTo(1080, 5);
    expect(picture.h).toBeCloseTo(720, 5);
    // The bed overfills, so a blur cannot fade the slide's own edges out.
    expect(bed.w).toBeGreaterThan(1080);
    expect(bed.h).toBeGreaterThan(1350);
  });

  it("sits the picture above centre, clear of the copy band", async () => {
    await renderSlideCanvas(framed, 0, 6, "portrait");
    const [, picture] = drawnImages;
    expect(picture.y + picture.h).toBeLessThanOrEqual(0.6 * 1350);
  });

  it("still crops when a layer asks to cover", async () => {
    const covered = { ...framed, layers: [{ ...framed.layers![0], fit: "cover" as const }] };
    await renderSlideCanvas(covered, 0, 6, "portrait");
    expect(drawnImages).toHaveLength(1);
    expect(drawnImages[0].h).toBeCloseTo(1350, 5);
  });
});
