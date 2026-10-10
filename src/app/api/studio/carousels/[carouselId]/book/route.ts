import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deckIsPostable, deckRatio } from "@/lib/carousels/deckFiles";
import { renderCarouselDeck } from "@/lib/carousels/renderDeck";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import { DuplicatePostError } from "@/lib/publisher/duplicates";
import { enqueueImagePost } from "@/lib/publisher/enqueue";
import { MAX_IMAGES_PER_POST } from "@/lib/publisher/images";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { readAppData } from "@/lib/storage/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Painting a deck that has changed since it was last rendered.
export const maxDuration = 120;

/**
 * Only the two networks the publisher really posts a picture carousel to.
 * TikTok and YouTube pictures are refused by `enqueueImagePost`, so they never
 * reach this route: the page keeps those as reminders on the carousel.
 */
const bookSchema = z.object({
  /** "YYYY-MM-DDTHH:mm" in PUBLISH_TIMEZONE, like every other booking. */
  publishAt: z.string().min(1),
  caption: z.string().trim().min(1).max(2200).optional(),
  platforms: z.array(z.enum(["instagram", "facebook"])).min(1)
});

/**
 * POST /api/studio/carousels/:id/book - books a carousel's rendered slides into
 * the publish queue through `enqueueImagePost`, so the post really goes out at
 * its slot. Every rule the queue applies holds here because it is the queue
 * that applies it: publishing switched on, nothing booked for today, no second
 * copy of a deck already booked, hosting configured for Instagram/Facebook.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ carouselId: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });

  const { carouselId } = await params;
  let body: z.infer<typeof bookSchema>;
  try {
    body = bookSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Pick Instagram and/or Facebook and a date and time." }, { status: 400 });
  }

  const data = await readAppData();
  const carousel = (data.videoStudio ?? defaultVideoStudio).carousels.find((entry) => entry.id === carouselId);
  if (!carousel) return NextResponse.json({ error: "Carousel not found." }, { status: 404 });
  if (carousel.slides.length === 0) {
    return NextResponse.json({ error: "This carousel has no slides to post." }, { status: 400 });
  }
  const ratio = deckRatio(carousel);
  if (!deckIsPostable(ratio)) {
    return NextResponse.json(
      { error: `A ${ratio} deck is the wrong shape for a picture post - switch it to portrait, square or landscape to book it.` },
      { status: 400 }
    );
  }
  if (carousel.slides.length > MAX_IMAGES_PER_POST) {
    return NextResponse.json(
      { error: `A picture post carries at most ${MAX_IMAGES_PER_POST} slides - this deck has ${carousel.slides.length}.` },
      { status: 400 }
    );
  }

  try {
    const files = await renderCarouselDeck(carousel);
    const item = await enqueueImagePost({
      imagePaths: files,
      publishAt: body.publishAt,
      title: carousel.title || undefined,
      caption: body.caption,
      platforms: body.platforms,
      visibility: "public",
      metadataSource: {
        streamTitle: carousel.title,
        spokenText: carousel.slides.map((slide) => `${slide.heading} ${slide.body}`.trim()).join(" ")
      },
      by: "api-carousel-book"
    });
    return NextResponse.json(
      {
        item: {
          id: item.id,
          publishAt: item.publishAt,
          platforms: Object.fromEntries(Object.entries(item.platforms).map(([id, state]) => [id, state?.status]))
        },
        timeZone: config.timezone
      },
      { status: 201 }
    );
  } catch (error) {
    const status = error instanceof DuplicatePostError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
