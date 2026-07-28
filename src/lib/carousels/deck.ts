/**
 * How big a carousel deck is, and how many decks one source produces.
 *
 * Kept free of every other import so the page picking the numbers and the
 * server writing the slides agree on the same rules — the picker can show
 * "12 photos → 12 slides" because it applies the exact function the generator
 * will.
 */

export const DEFAULT_SLIDE_COUNT = 8;
export const MIN_SLIDES = 4;
/** Instagram's per-post ceiling — the most slides one carousel can hold. */
export const MAX_SLIDES = 20;

export const DEFAULT_BATCH_COUNT = 1;
export const MAX_BATCH_COUNT = 5;

/**
 * The angle each batch is given. Asking one model for the same carousel five
 * times returns five rewrites of the same post; handing each batch its own
 * brief is what makes "3 batches of 8 slides" three posts worth publishing on
 * three different days. They cycle, so a sixth batch would reuse the first's.
 */
export const CAROUSEL_ANGLES = [
  {
    label: "The story",
    instruction:
      "Tell what actually happened, in order — the moment-by-moment story of this stream, with the turn or the surprise in the middle."
  },
  {
    label: "The lessons",
    instruction:
      "Pull the lessons out: what this proves, what it changed, what would be done differently next time. One lesson per slide."
  },
  {
    label: "The how-to",
    instruction:
      "Make it practical — the steps someone could copy tomorrow, in the order they would do them. Only steps that are actually in the source."
  },
  {
    label: "The mistakes",
    instruction:
      "Lead with the mistakes, myths and traps: what not to do and what to do instead. Blunt, never smug."
  },
  {
    label: "The receipts",
    instruction:
      "Lead with the specifics that were actually said — the numbers, tools, names and results. Never invent one to fill a slide."
  }
] as const;

export function carouselAngle(index: number): (typeof CAROUSEL_ANGLES)[number] {
  const length = CAROUSEL_ANGLES.length;
  return CAROUSEL_ANGLES[((index % length) + length) % length];
}

/**
 * How many slides a deck actually gets. Every uploaded photo earns its own
 * slide: quietly dropping four of twelve photos because the picker still said
 * "8 slides" would throw away material the user chose by hand.
 */
export function resolveSlideCount(input: { slideCount?: number; imageCount?: number }): number {
  const asked =
    Number.isFinite(input.slideCount) && (input.slideCount ?? 0) > 0 ? Math.round(input.slideCount!) : DEFAULT_SLIDE_COUNT;
  const wanted = Math.max(asked, input.imageCount ?? 0);
  return Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, wanted));
}

export function clampBatchCount(count?: number): number {
  if (!Number.isFinite(count) || !count || count < 1) return DEFAULT_BATCH_COUNT;
  return Math.min(MAX_BATCH_COUNT, Math.round(count));
}
