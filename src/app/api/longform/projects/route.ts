import { NextRequest, NextResponse } from "next/server";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg, runFfmpeg } from "@/lib/clipping/ffmpeg";
import { longformCreateSchema } from "@/lib/longform/schemas";
import { createProject, createProjectFromUrl, listProjects } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: NextRequest) {
  if (!resolveFfmpeg()) {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }
  try {
    // Cheap availability probe so a missing binary fails fast.
    await runFfmpeg(["-version"], { allowFailure: true });
  } catch {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `sourceId` field." }, { status: 400 });
  }
  const parsed = longformCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected a JSON body with a `sourceId` or a video `url`." },
      { status: 400 }
    );
  }

  try {
    const project = parsed.data.url
      ? await createProjectFromUrl(parsed.data.url, parsed.data.name)
      : await createProject(parsed.data.sourceId!, parsed.data.name);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start a project from that source." },
      { status: 400 }
    );
  }
}
