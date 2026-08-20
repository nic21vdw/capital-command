import { config } from "dotenv";
config({ path: path.join(process.cwd(), ".env"), quiet: true });

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { appleEmojiBytes } from "@/lib/carousels/emojiFiles";
import { carouselEmoji, paintSlide, slideImageLayers, type SlideImage } from "@/lib/carousels/render";
import { carouselImagePath, parseCarouselImageId } from "@/lib/carousels/uploads";
import { emojiImageKey } from "@/lib/emoji/apple";
import type { Carousel } from "@/types/domain";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);

async function main() {
  const deckFile = args.get("deck")!;
  const outDir = args.get("out")!;
  const width = Number(args.get("width") ?? 1080);

  async function decode(carousel: Carousel) {
    const images = new Map<string, SlideImage | null>();
    const sources = new Set<string>();
    for (const slide of carousel.slides) for (const layer of slideImageLayers(slide)) sources.add(layer.src);
    await Promise.all([
      ...[...sources].map(async (src) => {
        const stored = parseCarouselImageId(src);
        const file = stored ? carouselImagePath(stored) : null;
        const bytes = file ? await readFile(file).catch(() => null) : null;
        images.set(src, bytes ? await loadImage(bytes).catch(() => null) : null);
      }),
      ...carouselEmoji(carousel.slides).map(async (glyph) => {
        const bytes = await appleEmojiBytes(glyph).catch(() => null);
        images.set(emojiImageKey(glyph), bytes ? await loadImage(bytes).catch(() => null) : null);
      })
    ]);
    return images;
  }

  const carousel = JSON.parse(await readFile(deckFile, "utf8")) as Carousel;
  await mkdir(outDir, { recursive: true });
  const images = await decode(carousel);
  const height = Math.round((width * 1350) / 1080);
  for (const [index, slide] of carousel.slides.entries()) {
    const canvas = createCanvas(width, height);
    paintSlide(canvas.getContext("2d"), { slide, index, total: carousel.slides.length, width, height, images });
    await writeFile(path.join(outDir, `slide-${String(index + 1).padStart(2, "0")}.jpg`), canvas.toBuffer("image/jpeg", 88));
  }
  console.log(`rendered ${carousel.slides.length} slides -> ${outDir}`);

}

main();
