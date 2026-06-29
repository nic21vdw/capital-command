import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import path from "node:path";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg } from "@/lib/clipping/ffmpeg";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { startExport } from "@/lib/clipping/export";
import { clipProjectSchema } from "@/lib/storage/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!resolveFfmpeg()) {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  let project;
  try {
    project = clipProjectSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid export request." }, { status: 400 });
  }

  // The base clip file must still exist on disk.
  const basePath = path.join(outputDir(jobId), project.sourceFile);
  try {
    await stat(basePath);
  } catch {
    return NextResponse.json(
      { error: "The base clip file no longer exists. Re-render the clip before exporting." },
      { status: 404 }
    );
  }

  const record = startExport({
    jobId,
    sourceFile: project.sourceFile,
    baseDurationSec: project.baseDurationSec,
    trimStart: project.trimStart,
    trimEnd: project.trimEnd || project.baseDurationSec,
    reframe: project.reframe,
    captions: project.captions,
    captionStyle: project.captionStyle,
    captionsVisible: project.captionsVisible,
    highlightCurrentWord: project.highlightCurrentWord,
    overlays: project.overlays,
    audio: project.audio,
    settings: project.exportSettings
  });
  return NextResponse.json({ export: record }, { status: 201 });
}
