import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  DECK_MANIFEST_FILE,
  DECK_SLIDE_QUALITY,
  deckDir,
  deckPixelSize,
  deckRatio,
  planDeckRender,
  type DeckManifest
} from "@/lib/carousels/deckFiles";
import { appleEmojiBytes } from "@/lib/carousels/emojiFiles";
import { carouselEmoji, paintSlide, slideImageLayers, type SlideImage } from "@/lib/carousels/render";
import { emojiImageKey } from "@/lib/emoji/apple";
import { carouselImagePath, parseCarouselImageId } from "@/lib/carousels/uploads";
import type { Carousel } from "@/types/domain";

/**
 * Renders a stored deck to real JPEG files on disk, so a carousel can be booked
 * into the publish queue like any other output. Slides are drawn client-side
 * everywhere else in the app, which is why nothing server-side could hand the
 * publisher a picture until this existed.
 *
 * JPEG at a picture-post width, not PNG at the frame's own resolution: this is
 * the file Instagram will be asked to download at the slot, and the format and
 * the size band are the two things it refuses on.
 *
 * The layout is not repeated here: `paintSlide` is the same routine the editor
 * and the browser download go through, given a Node canvas instead of the
 * browser's.
 */

/** Turns a slide layer's `src` into bytes the Node canvas can decode. */
async function readLayerSource(src: string): Promise<Buffer | null> {
  const dataUrl = src.match(/^data:[^;,]+;base64,(.+)$/s);
  if (dataUrl) return Buffer.from(dataUrl[1], "base64");
  const stored = parseCarouselImageId(src);
  if (!stored) return null;
  const file = carouselImagePath(stored);
  if (!file) return null;
  return readFile(file).catch(() => null);
}

async function decodeLayers(carousel: Carousel): Promise<Map<string, SlideImage | null>> {
  const sources = new Set<string>();
  for (const slide of carousel.slides) {
    for (const layer of slideImageLayers(slide)) sources.add(layer.src);
  }
  const images = new Map<string, SlideImage | null>();
  await Promise.all([
    ...[...sources].map(async (src) => {
      const bytes = await readLayerSource(src);
      images.set(src, bytes ? await loadImage(bytes).catch(() => null) : null);
    }),
    // The server has no emoji font at all — an emoji left to `fillText` here
    // comes out as nothing, which is how decks were booked with the copy full
    // of gaps. They are pictures, same as the stills.
    ...carouselEmoji(carousel.slides).map(async (glyph) => {
      const bytes = await appleEmojiBytes(glyph);
      images.set(emojiImageKey(glyph), bytes ? await loadImage(bytes).catch(() => null) : null);
    })
  ]);
  return images;
}

async function readManifest(dir: string): Promise<DeckManifest | null> {
  const raw = await readFile(path.join(dir, DECK_MANIFEST_FILE), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeckManifest;
    return Array.isArray(parsed?.slides) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The deck's slide files, in order, painting only what has changed since the
 * last render. Safe to call on every plan: an unchanged deck costs a directory
 * listing and a manifest read.
 */
export async function renderCarouselDeck(carousel: Carousel): Promise<string[]> {
  if (carousel.slides.length === 0) return [];

  const dir = deckDir(carousel.id);
  await mkdir(dir, { recursive: true });
  const present = await readdir(dir).catch(() => [] as string[]);
  const plan = planDeckRender(carousel, await readManifest(dir), present);

  if (plan.render.length > 0) {
    const ratio = deckRatio(carousel);
    const { width, height } = deckPixelSize(ratio);
    const images = await decodeLayers(carousel);
    for (const index of plan.render) {
      const canvas = createCanvas(width, height);
      paintSlide(canvas.getContext("2d"), {
        slide: carousel.slides[index],
        index,
        total: carousel.slides.length,
        width,
        height,
        images
      });
      await writeFile(path.join(dir, plan.files[index]), canvas.toBuffer("image/jpeg", DECK_SLIDE_QUALITY));
    }
  }

  for (const file of plan.stale) await rm(path.join(dir, file), { force: true });
  await writeFile(path.join(dir, DECK_MANIFEST_FILE), `${JSON.stringify(plan.manifest, null, 2)}\n`);

  return plan.files.map((file) => path.join(dir, file));
}
