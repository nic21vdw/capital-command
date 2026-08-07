import { createHash } from "node:crypto";
import path from "node:path";
import { DEFAULT_ASPECT_RATIO, aspectSpec, slidePixelSize } from "@/lib/carousels/render";
import { dataPath } from "@/lib/paths";
import { imagePostAspectAllowed, imagePostWidth } from "@/lib/publisher/images";
import type { Carousel, CarouselAspectRatio, CarouselSlide } from "@/types/domain";

/**
 * Where a rendered deck lives on disk, and which of its slides still need
 * painting. Kept apart from the renderer so the decision — what is stale, what
 * is already there, what is left over from a shorter deck — is testable without
 * a canvas.
 */

export const DECK_MANIFEST_FILE = "slides.json";

export function deckDir(carouselId: string): string {
  return dataPath("carousels", carouselId);
}

/**
 * JPEG, not PNG: Instagram's Content Publishing API takes JPEG, and a deck the
 * pipeline books is a deck that has to survive its slot. The extension is what
 * picks the upload's content type in `hosting.ts`, so the two cannot drift.
 */
export const DECK_SLIDE_EXTENSION = ".jpg";

/** Quality high enough that flat slide copy shows no ringing, small enough to host. */
export const DECK_SLIDE_QUALITY = 92;

export function slideFileName(index: number): string {
  return `slide-${String(index + 1).padStart(2, "0")}${DECK_SLIDE_EXTENSION}`;
}

export function slideFilePath(carouselId: string, index: number): string {
  return path.join(deckDir(carouselId), slideFileName(index));
}

export function deckRatio(carousel: Pick<Carousel, "aspectRatio">): CarouselAspectRatio {
  return carousel.aspectRatio ?? DEFAULT_ASPECT_RATIO;
}

/**
 * The pixels a booked deck renders at. A landscape frame is nominally 1920 wide
 * and Instagram refuses anything over 1440, so the frame is scaled down to the
 * widest size a picture post is allowed to be rather than rendered at a width
 * that can only be rejected. The aspect ratio is untouched.
 */
export function deckPixelSize(ratio: CarouselAspectRatio): { width: number; height: number } {
  return slidePixelSize(ratio, imagePostWidth(aspectSpec(ratio).width));
}

/** Whether a deck in this frame is a shape a picture post can carry at all. */
export function deckIsPostable(ratio: CarouselAspectRatio): boolean {
  const { width, height } = deckPixelSize(ratio);
  return imagePostAspectAllowed(width, height);
}

/** Key order is what a hash of an object actually hashes, so fix it. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
}

/**
 * Everything that changes what a slide looks like: its own content, its
 * position in the deck (the counter reads "3/8") and the frame it is painted
 * in. Editing slide two must not re-render the other seven, and adding a ninth
 * slide must re-render all nine.
 */
export function slideFingerprint(input: {
  slide: CarouselSlide;
  index: number;
  total: number;
  ratio: CarouselAspectRatio;
}): string {
  const payload = canonical({
    slide: input.slide,
    index: input.index,
    total: input.total,
    ratio: input.ratio
  });
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export type DeckManifest = {
  ratio: CarouselAspectRatio;
  /**
   * Rendered pixel width. Recorded because the ratio alone no longer fixes it —
   * a change to the size rule has to repaint decks painted under the old one,
   * and a manifest from before this was written has none, so it repaints too.
   */
  width?: number;
  /** One entry per slide, in deck order. */
  slides: { file: string; hash: string }[];
};

export type DeckRenderPlan = {
  /** Slide indexes that must be painted. */
  render: number[];
  /** File names in the deck folder that no longer belong to it. */
  stale: string[];
  /** Every slide file of the finished deck, in order. */
  files: string[];
  manifest: DeckManifest;
};

/**
 * What rendering this deck would do, given what is already on disk. A slide is
 * repainted only when its fingerprint moved or its file is missing — the
 * standing instruction re-plans a run every couple of minutes, and repainting
 * an unchanged deck each time would be the whole cost of it.
 */
export function planDeckRender(
  carousel: Pick<Carousel, "slides" | "aspectRatio">,
  manifest: DeckManifest | null,
  present: string[]
): DeckRenderPlan {
  const ratio = deckRatio(carousel);
  const width = deckPixelSize(ratio).width;
  const total = carousel.slides.length;
  const known = new Set(present);
  const slides = carousel.slides.map((slide, index) => ({
    file: slideFileName(index),
    hash: slideFingerprint({ slide, index, total, ratio })
  }));

  const sameFrame = manifest?.ratio === ratio && manifest?.width === width;
  const render = slides
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => {
      if (!known.has(entry.file)) return true;
      if (!sameFrame) return true;
      return manifest?.slides[index]?.hash !== entry.hash;
    })
    .map(({ index }) => index);

  const wanted = new Set(slides.map((entry) => entry.file));
  const stale = present.filter((file) => file !== DECK_MANIFEST_FILE && !wanted.has(file));

  return { render, stale, files: slides.map((entry) => entry.file), manifest: { ratio, width, slides } };
}
