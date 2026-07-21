import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/longform/store";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { carouselGenerationConfigured, DEFAULT_SLIDE_COUNT, generateCarousel } from "@/lib/studio/carousel";
import { scriptFullText } from "@/lib/studio/scripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Writes carousel copy from a script, a long-form project's transcript, or
 * pasted text, and saves the carousel. The slides are rendered to PNGs
 * client-side on the Carousels page.
 */
export async function POST(request: NextRequest) {
  let scriptId = "";
  let longformId = "";
  let text = "";
  let title = "";
  let slideCount = DEFAULT_SLIDE_COUNT;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.scriptId === "string") scriptId = body.scriptId;
    if (typeof body.longformId === "string") longformId = body.longformId;
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
  let sourceType: "script" | "longform" | "custom" = "custom";
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
  }

  if (!sourceText.trim()) {
    return NextResponse.json({ error: "Pick a script, a long-form project, or paste some text." }, { status: 400 });
  }

  const { carousel, reason } = await generateCarousel({
    title: sourceTitle || "Carousel",
    sourceText,
    slideCount,
    sourceType,
    sourceId
  });

  await writeAppData({ ...data, videoStudio: { ...studio, carousels: [carousel, ...studio.carousels] } });
  return NextResponse.json({ carousel, reason, configured: carouselGenerationConfigured() });
}
