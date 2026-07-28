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
