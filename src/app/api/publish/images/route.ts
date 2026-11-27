import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bookedWhenInSentence } from "@/lib/carousels/booked";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabledMessage";
import { DuplicatePostError } from "@/lib/publisher/duplicates";
import { enqueueImagePost } from "@/lib/publisher/enqueue";
import { MAX_IMAGES_PER_POST } from "@/lib/publisher/images";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bookSchema = z.object({
  imagePaths: z
    .array(z.string().trim().min(1).refine((entry) => path.isAbsolute(entry)))
    .min(1)
    .max(MAX_IMAGES_PER_POST),
  publishAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  caption: z.string().trim().min(1).max(2200),
  title: z.string().trim().min(1).max(200).optional(),
  platforms: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
  pairFacebook: z.boolean().optional()
});

function alreadyBooked(publishAt: string | undefined, timeZone: string): string {
  return publishAt
    ? `These pictures are already booked for ${bookedWhenInSentence(publishAt, timeZone, null)}.`
    : "These pictures are already booked.";
}

export async function POST(request: NextRequest) {
  const config = publisherConfig();
  if (!config.enabled) return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });

  let body: z.infer<typeof bookSchema>;
  try {
    body = bookSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: `Send 1 to ${MAX_IMAGES_PER_POST} absolute image paths, a caption, a "YYYY-MM-DDTHH:mm" time and Instagram, Facebook and/or LinkedIn.`
      },
      { status: 400 }
    );
  }

  try {
    const item = await enqueueImagePost({
      imagePaths: body.imagePaths,
      publishAt: body.publishAt,
      title: body.title,
      caption: body.caption,
      platforms: body.platforms,
      pairFacebook: body.pairFacebook,
      visibility: "public",
      metadataSource: { streamTitle: body.title, spokenText: body.caption },
      by: "api-image-post-book"
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
    if (error instanceof DuplicatePostError) {
      const existing = await publishQueue(config).get(error.existingItemId).catch(() => undefined);
      return NextResponse.json(
        { error: alreadyBooked(existing?.publishAt, config.timezone), itemId: error.existingItemId },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
