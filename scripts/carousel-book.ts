import path from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { renderCarouselDeck } from "@/lib/carousels/renderDeck";
import { publisherConfig } from "@/lib/publisher/config";
import { enqueueImagePost } from "@/lib/publisher/enqueue";
import { publishQueue } from "@/lib/publisher/queue";
import { generateSlots, slotGrid } from "@/lib/publisher/slots";
import { readAppData, writeAppData } from "@/lib/storage/store";
import type { Carousel } from "@/types/domain";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

/**
 * Saves already-written decks into the app's store, renders them to real
 * files, and books them into the next open posting slots.
 *
 * Booking only — nothing is sent here. The scheduled publish runner picks the
 * items up at their slots, exactly as it does for a deck the pipeline made.
 *
 *   npx tsx scripts/carousel-book.ts --decks a.json,b.json [--dry-run]
 */

async function main() {
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(arg.slice(2), next);
      i += 1;
    } else {
      flags.add(arg.slice(2));
    }
  }

  const files = (args.get("decks") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  if (!files.length) throw new Error("usage: --decks a.json,b.json [--dry-run]");
  const dryRun = flags.has("dry-run");

  const publisher = publisherConfig();
  if (!publisher.enabled) throw new Error("Publishing is switched off — nothing was booked.");

  const decks: Carousel[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(file, "utf8")) as Carousel & Record<string, unknown>;
    // The review fields the regen script adds are not part of a stored deck.
    delete raw.hookRetries;
    delete raw.illustrationNote;
    decks.push(raw as Carousel);
  }

  // Into the store first: a booked deck the app cannot see is a deck nobody can
  // find again, and the Uploading Center matches its cards by carousel id.
  const data = await readAppData();
  const studio = data.videoStudio;
  if (!studio) throw new Error("The app store has no Video Studio section — nothing was booked.");
  const stored = studio.carousels ?? [];
  const existing = new Set(stored.map((deck) => deck.id));
  const fresh = decks.filter((deck) => !existing.has(deck.id));
  if (!dryRun && fresh.length) {
    studio.carousels = [...fresh, ...stored];
    await writeAppData(data);
  }
  console.log(`decks: ${decks.length} (${fresh.length} new to the store)`);

  const upcoming = await publishQueue().list();
  const taken = new Set(upcoming.map((item) => item.publishAt));
  const slots = generateSlots({
    timeZone: publisher.timezone,
    days: publisher.bookingHorizonDays,
    ...slotGrid(publisher)
  })
    .filter((slot) => slot.bookable && !taken.has(slot.utc))
    .map((slot) => slot.utc);

  if (slots.length < decks.length) {
    console.log(
      `only ${slots.length} open slot(s) for ${decks.length} decks — the posting grid is the limit, add a time to PUBLISH_SLOT_TIMES for more room`
    );
  }

  for (const [index, deck] of decks.entries()) {
    const publishAt = slots[index];
    if (!publishAt) {
      console.log(`SKIPPED "${deck.title}" — no open slot`);
      continue;
    }
    const files = await renderCarouselDeck(deck);
    if (!files.length) {
      console.log(`SKIPPED "${deck.title}" — nothing rendered`);
      continue;
    }
    if (dryRun) {
      console.log(`WOULD BOOK "${deck.title}" — ${files.length} slides at ${publishAt}`);
      continue;
    }
    const item = await enqueueImagePost({
      imagePaths: files,
      publishAt,
      title: deck.title,
      visibility: "public",
      by: "enqueue-image"
    });
    console.log(
      `BOOKED "${deck.title}" — ${files.length} slides at ${item.publishAt} -> ${Object.keys(item.platforms).join(", ")}`
    );
  }
}

main();
