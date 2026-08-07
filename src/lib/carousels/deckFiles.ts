import { createHash } from "node:crypto";
import path from "node:path";
import { DEFAULT_ASPECT_RATIO } from "@/lib/carousels/render";
import { dataPath } from "@/lib/paths";
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

export function slideFileName(index: number): string {
  return `slide-${String(index + 1).padStart(2, "0")}.png`;
}

export function slideFilePath(carouselId: string, index: number): string {
  return path.join(deckDir(carouselId), slideFileName(index));
}

export function deckRatio(carousel: Pick<Carousel, "aspectRatio">): CarouselAspectRatio {
  return carousel.aspectRatio ?? DEFAULT_ASPECT_RATIO;
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
  const total = carousel.slides.length;
  const known = new Set(present);
  const slides = carousel.slides.map((slide, index) => ({
    file: slideFileName(index),
    hash: slideFingerprint({ slide, index, total, ratio })
  }));

  const sameFrame = manifest?.ratio === ratio;
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

  return { render, stale, files: slides.map((entry) => entry.file), manifest: { ratio, slides } };
}
