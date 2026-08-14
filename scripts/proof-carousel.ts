import { renderCarouselDeck } from "@/lib/carousels/renderDeck";
import { readAppData } from "@/lib/storage/store";

/**
 * Renders a stored carousel to the exact files the publisher would post, and
 * says where they are, so a deck can be LOOKED AT before it is booked.
 *
 * Slides were drawn only in the browser for most of this app's life, which is
 * why nothing ever checked one: the pictures existed for the length of a
 * download. They are files now, and this is the door to them.
 *
 *   npm run carousel:proof              # the most recently written deck
 *   npm run carousel:proof -- <id>      # a particular one
 *   npm run carousel:proof -- --list    # what there is to look at
 */

async function main() {
  const data = await readAppData();
  const carousels = data.videoStudio?.carousels ?? [];
  if (carousels.length === 0) {
    console.log("No carousels in this checkout.");
    return;
  }

  const [argument] = process.argv.slice(2);

  if (argument === "--list") {
    for (const carousel of carousels.slice(-20)) {
      console.log(`${carousel.id}  ${carousel.slides.length} slides  ${carousel.title}`);
    }
    return;
  }

  const carousel = argument ? carousels.find((entry) => entry.id === argument) : carousels[carousels.length - 1];
  if (!carousel) {
    console.error(`No carousel with id ${argument}. Try --list.`);
    process.exitCode = 1;
    return;
  }

  const files = await renderCarouselDeck(carousel);
  console.log(`${carousel.title} — ${files.length} slides`);
  for (const [index, file] of files.entries()) {
    const slide = carousel.slides[index];
    console.log(`\n${index + 1}. ${file}`);
    console.log(`   ${slide.heading}`);
    if (slide.body) console.log(`   ${slide.body}`);
  }
}

void main();
