import { NextRequest, NextResponse } from "next/server";
import type { CarouselImage } from "@/lib/carousels/imageSlides";
import { MAX_BATCH_IMAGES, saveCarouselImage } from "@/lib/carousels/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A batch of full-resolution phone photos takes a moment to land.
export const maxDuration = 120;

/**
 * POST /api/studio/carousels/images — takes a batch of photos (multipart,
 * repeated `files` fields) to be used as carousel slide material and returns
 * the URLs the slides will reference. Uploading is separate from generating so
 * the photos survive a failed or repeated generate, and so the same batch can
 * feed several batches of slides.
 */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded photos." }, { status: 400 });
  }

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No photos were attached." }, { status: 400 });
  }
  if (files.length > MAX_BATCH_IMAGES) {
    return NextResponse.json(
      { error: `A carousel holds ${MAX_BATCH_IMAGES} slides, so ${MAX_BATCH_IMAGES} photos at a time.` },
      { status: 400 }
    );
  }

  const images: CarouselImage[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    try {
      images.push(await saveCarouselImage(await file.arrayBuffer(), file.type, file.name));
    } catch (error) {
      rejected.push(error instanceof Error ? error.message : `${file.name} could not be saved.`);
    }
  }

  if (images.length === 0) {
    return NextResponse.json({ error: rejected.join(" ") || "None of those photos could be saved." }, { status: 400 });
  }
  return NextResponse.json({ images, rejected }, { status: 201 });
}
