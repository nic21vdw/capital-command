import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { extractCarouselFrames } from "@/lib/carousels/frames";
import { getJob } from "@/lib/clipping/jobs";
import { clipCarouselSource } from "@/lib/studio/carousel";
import { getProject } from "@/lib/longform/store";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { carouselGenerationConfigured, DEFAULT_SLIDE_COUNT, generateCarousel } from "@/lib/studio/carousel";
import { scriptFullText } from "@/lib/studio/scripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Writes carousel copy from a script, a long-form project's transcript, a
 * short-form video (a clip), or pasted text, and saves the carousel. Video
 * sources automatically contribute real stream frames as full-bleed artwork;
 * the slides are rendered to PNGs client-side on the Carousels page.
 */
export async function POST(request: NextRequest) {
  let scriptId = "";
  let longformId = "";
  let clipJobId = "";
  let clipId = "";
  let text = "";
  let title = "";
  let slideCount = DEFAULT_SLIDE_COUNT;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.scriptId === "string") scriptId = body.scriptId;
    if (typeof body.longformId === "string") longformId = body.longformId;
    if (typeof body.clipJobId === "string") clipJobId = body.clipJobId;
    if (typeof body.clipId === "string") clipId = body.clipId;
    if (typeof body.text === "string") text = body.text;
    if (typeof body.title === "string") title = body.title.trim();
    const count = Number(body.slideCount);
    if (Number.isFinite(count)) slideCount = Math.round(count);
  } catch {
    // Defaults apply.
  }

  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;

  let sourceText = text;
  let sourceTitle = title;
  let sourceType: "script" | "longform" | "short" | "custom" = "custom";
  let sourceId: string | undefined;

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
  }

  if (!sourceText.trim()) {
    return NextResponse.json(
      { error: "Pick a script, a long-form project, a short-form video, or paste some text." },
      { status: 400 }
    );
  }

  const { carousel, reason } = await generateCarousel({
    title: sourceTitle || "Carousel",
    sourceText,
    slideCount,
    sourceType,
    sourceId
  });

  let screenshotCount = 0;
  let screenshotError: string | undefined;
  if (sourceId && (sourceType === "longform" || sourceType === "short")) {
    try {
      const frames = await extractCarouselFrames({
        sourceType,
        sourceId,
        count: carousel.slides.length
      });
      if (frames.length === 0) throw new Error("No usable screenshots were found in the stream.");
      screenshotCount = frames.length;
      carousel.slides = carousel.slides.map((slide, index) => ({
        ...slide,
        headingColor: "#ffffff",
        bodyColor: "rgba(255,255,255,0.88)",
        layers: [
          {
            id: randomUUID(),
            type: "image" as const,
            src: frames[index % frames.length],
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            radius: 0,
            fit: "cover" as const,
            layout: "full-bleed" as const,
            scale: 1,
            focusX: 0.5,
            focusY: 0.5,
            opacity: 1,
            darken: index === 0 ? 0.46 : 0.38
          },
          ...(slide.layers ?? []).filter((layer) => layer.type !== "image" || layer.layout !== "full-bleed")
        ]
      }));
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : "Could not add screenshots from the stream.";
    }
  }

  await writeAppData({ ...data, videoStudio: { ...studio, carousels: [carousel, ...studio.carousels] } });
  return NextResponse.json({
    carousel,
    reason,
    configured: carouselGenerationConfigured(),
    screenshotCount,
    screenshotError
  });
}
