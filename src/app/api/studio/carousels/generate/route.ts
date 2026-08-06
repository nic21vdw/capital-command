import { NextRequest, NextResponse } from "next/server";
import type { CarouselImage } from "@/lib/carousels/imageSlides";
import { carouselImageExists, carouselImageUrl, MAX_BATCH_IMAGES, parseCarouselImageId } from "@/lib/carousels/uploads";
import type { TranscriptSegment } from "@/lib/carousels/anchors";
import { getJob } from "@/lib/clipping/jobs";
import { clipCarouselSource } from "@/lib/studio/carousel";
import { getProject } from "@/lib/longform/store";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import {
  carouselGenerationConfigured,
  clampBatchCount,
  DEFAULT_SLIDE_COUNT,
  generateCarouselBatches,
  resolveSlideCount,
  type CarouselImageMode
} from "@/lib/studio/carousel";
import { scriptFullText } from "@/lib/studio/scripts";
import type { Carousel } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Batches run concurrently, but each one is a reasoning model writing a full deck.
export const maxDuration = 600;

/**
 * Writes carousel copy from a script, a long-form project's transcript, a
 * short-form video (a clip), an uploaded batch of photos, or pasted text, and
 * saves it. `batchCount` writes several carousels from the same source in one
 * pass, each on its own angle; `imageIds` name photos (already uploaded to
 * `/api/studio/carousels/images`) that ride on the leading slides. The slides
 * are rendered to PNGs client-side on the Carousels page.
 */
export async function POST(request: NextRequest) {
  let scriptId = "";
  let longformId = "";
  let clipJobId = "";
  let clipId = "";
  let text = "";
  let title = "";
  let imageNotes = "";
  let imageIds: string[] = [];
  let slideCount = DEFAULT_SLIDE_COUNT;
  let batchCount = 1;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.scriptId === "string") scriptId = body.scriptId;
    if (typeof body.longformId === "string") longformId = body.longformId;
    if (typeof body.clipJobId === "string") clipJobId = body.clipJobId;
    if (typeof body.clipId === "string") clipId = body.clipId;
    if (typeof body.text === "string") text = body.text;
    if (typeof body.title === "string") title = body.title.trim();
    if (typeof body.imageNotes === "string") imageNotes = body.imageNotes.trim();
    if (Array.isArray(body.imageIds)) {
      // Accept either the stored id or the URL a previous upload handed back.
      imageIds = body.imageIds
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => parseCarouselImageId(entry) ?? entry)
        .slice(0, MAX_BATCH_IMAGES);
    }
    const count = Number(body.slideCount);
    if (Number.isFinite(count)) slideCount = Math.round(count);
    batchCount = clampBatchCount(Number(body.batchCount));
  } catch {
    // Defaults apply.
  }

  // Only photos this app actually stored may be drawn into a slide.
  const images: CarouselImage[] = [];
  for (const id of imageIds) {
    if (await carouselImageExists(id)) images.push({ id, url: carouselImageUrl(id) });
  }
  if (imageIds.length > 0 && images.length === 0) {
    return NextResponse.json({ error: "Those photos are no longer on disk. Upload them again." }, { status: 409 });
  }

  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;

  let sourceText = text;
  let sourceTitle = title;
  let sourceType: Carousel["sourceType"] = "custom";
  let sourceId: string | undefined;
  // Uploaded photos are the subject and sit on top; stills lifted from the
  // recording are the setting and go behind the copy.
  let imageMode: CarouselImageMode = "photo";
  let imageNote: string | null = null;
  let transcript: TranscriptSegment[] | undefined;
  let recordingId: string | undefined;

  if (scriptId) {
    const script = studio.scripts.find((entry) => entry.id === scriptId);
    if (!script) return NextResponse.json({ error: "Script not found." }, { status: 404 });
    sourceText = scriptFullText(script);
    sourceTitle = sourceTitle || script.title;
    sourceType = "script";
    sourceId = script.id;
  } else if (longformId) {
    const project = await getProject(longformId);
    if (!project) return NextResponse.json({ error: "Long-form project not found." }, { status: 404 });
    sourceText = project.transcript.map((segment) => segment.text).join(" ");
    sourceTitle = sourceTitle || project.name;
    sourceType = "longform";
    sourceId = project.id;
    if (!sourceText.trim()) {
      return NextResponse.json({ error: "That project has no transcript to work from." }, { status: 409 });
    }
    // No photos were chosen by hand, so illustrate the deck with the video's
    // own frames — the same slides the Stream Pipeline writes unattended. The
    // stills are cut AFTER the copy, at the moment each slide is about.
    if (images.length === 0 && project.sourceId) {
      transcript = project.transcript;
      recordingId = project.sourceId;
      imageMode = "backdrop";
    }
  } else if (clipJobId) {
    const job = await getJob(clipJobId);
    if (!job) return NextResponse.json({ error: "Short-form video not found." }, { status: 404 });
    const clip = job.clips.find((entry) => entry.id === clipId);
    if (!clip) return NextResponse.json({ error: "That clip is no longer in the job." }, { status: 404 });
    const source = clipCarouselSource(job, clip);
    sourceText = source.text;
    sourceTitle = sourceTitle || source.title;
    sourceType = "short";
    sourceId = `${job.id}:${clip.id}`;
    if (!sourceText.trim()) {
      return NextResponse.json({ error: "That clip has no transcript or title to work from." }, { status: 409 });
    }
  } else if (images.length > 0 && !sourceText.trim()) {
    // Photos only: the description of the batch is the whole source.
    sourceType = "images";
    sourceText = imageNotes;
    sourceTitle = sourceTitle || "Photo carousel";
  }

  if (!sourceText.trim()) {
    return NextResponse.json(
      {
        error:
          images.length > 0
            ? "Describe the photos, or pick a script, video or clip for the slides to be written from."
            : "Pick a script, a long-form project, a short-form video, some photos, or paste some text."
      },
      { status: 400 }
    );
  }

  const { carousels, reason } = await generateCarouselBatches({
    title: sourceTitle || "Carousel",
    sourceText,
    slideCount,
    batchCount,
    sourceType,
    sourceId,
    images,
    imageMode,
    imageNotes,
    transcript,
    recordingId
  });

  if (carousels.length === 0) {
    return NextResponse.json({ error: reason ?? "Could not write a carousel." }, { status: 502 });
  }

  // Batch 1 lands at the top of the list, its siblings directly under it.
  await writeAppData({ ...data, videoStudio: { ...studio, carousels: [...carousels, ...studio.carousels] } });
  return NextResponse.json({
    carousels,
    reason: [reason, imageNote].filter(Boolean).join(" ") || null,
    configured: carouselGenerationConfigured()
  });
}
