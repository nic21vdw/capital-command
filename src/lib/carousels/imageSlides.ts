import type { CarouselSlide, SlideLayer } from "@/types/domain";

/**
 * Turning an uploaded batch of photos into slides.
 *
 * A photo takes the top of the slide, full-bleed, and the written copy sits in
 * the strip underneath it. The copy stays in `heading`/`body` rather than being
 * baked into text layers, so it is still measured, wrapped and centered at
 * render time — which is what lets one photo slide export correctly at 4:5,
 * 1:1, 9:16 and 16:9 without being re-laid out per ratio.
 */

export const IMAGE_SLIDE_LAYOUT = {
  /** How much of the slide height the photo claims, from the top. */
  imageHeight: 0.56,
  /** Where the copy is centered: clear of the photo above and the accent bar below. */
  band: { top: 0.58, bottom: 0.92 }
} as const;

/** A stored image offered as slide material. */
export type CarouselImage = {
  id: string;
  /** Where the canvas loads it from (same-origin, so exports don't taint). */
  url: string;
  fileName?: string;
};

/**
 * Puts one photo on each slide, in the order they were uploaded. Slides past
 * the last photo are left as plain copy slides — `resolveSlideCount` sizes the
 * deck so a photo is never dropped, and extras here are ignored rather than
 * stacked two-to-a-slide.
 */
/**
 * How a still from the video is laid behind the copy: full bleed, with a veil
 * over it dark enough that white text reads over any frame, and the copy set in
 * the lower half where a talking head is least likely to be.
 *
 * The still is FRAMED, never cropped. A 16:9 frame cropped to fill a 4:5 slide
 * throws away 55% of its width from the middle out, which is exactly the half
 * the webcam sits in — so the picture became a zoom into the middle of a screen
 * share with Nic's face sliced off at the edge. `fit: "frame"` keeps the whole
 * frame, face and editor and terminal together, over a blurred fill of itself.
 */
export const BACKDROP_SLIDE_LAYOUT = {
  scrim: 0.52,
  band: { top: 0.6, bottom: 0.9 },
  headingColor: "#ffffff",
  bodyColor: "rgba(255,255,255,0.86)"
} as const;

/**
 * Puts a video still behind each slide's copy, in order. Used for carousels
 * written from a recording: slide 1 shows an early moment, the last slide a
 * late one, so the deck reads as the video it came from.
 */
export function attachSlideBackdrops(
  slides: CarouselSlide[],
  // Positional, and a hole is meaningful: a slide whose stills all failed keeps
  // its place rather than pulling the next slide's picture back onto itself.
  images: Array<CarouselImage | null>
): CarouselSlide[] {
  return slides.map((slide, index) => {
    const image = images[index];
    if (!image) return slide;
    const layer: SlideLayer = {
      id: `layer-${image.id}`,
      type: "image",
      src: image.url,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      fit: "frame"
    };
    return {
      ...slide,
      scrim: BACKDROP_SLIDE_LAYOUT.scrim,
      textBand: { ...BACKDROP_SLIDE_LAYOUT.band },
      headingColor: slide.headingColor ?? BACKDROP_SLIDE_LAYOUT.headingColor,
      bodyColor: slide.bodyColor ?? BACKDROP_SLIDE_LAYOUT.bodyColor,
      layers: [layer, ...(slide.layers ?? [])]
    };
  });
}

export function attachSlideImages(slides: CarouselSlide[], images: CarouselImage[]): CarouselSlide[] {
  return slides.map((slide, index) => {
    const image = images[index];
    if (!image) return slide;
    const layer: SlideLayer = {
      id: `layer-${image.id}`,
      type: "image",
      src: image.url,
      x: 0,
      y: 0,
      width: 1,
      height: IMAGE_SLIDE_LAYOUT.imageHeight,
      fit: "cover"
    };
    return {
      ...slide,
      textBand: { ...IMAGE_SLIDE_LAYOUT.band },
      layers: [layer, ...(slide.layers ?? [])]
    };
  });
}
