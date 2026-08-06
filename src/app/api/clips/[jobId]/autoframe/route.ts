import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import path from "node:path";
import { FFMPEG_MISSING_MESSAGE, resolveFfmpeg } from "@/lib/clipping/ffmpeg";
import { getJob, outputDir } from "@/lib/clipping/jobs";
import { planClipFraming } from "@/lib/clipping/autoframe";
import { framingToReframe, SPEAKER_STACK_LAYOUT } from "@/lib/clipping/framing";
import { LAYOUT_MODE_PRESETS } from "@/lib/clipping/layouts";
import type { ClipCompositionMode } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STACK_MODE = (Object.keys(LAYOUT_MODE_PRESETS) as ClipCompositionMode[]).find(
  (mode) => LAYOUT_MODE_PRESETS[mode] === SPEAKER_STACK_LAYOUT
);

/**
 * Finds the speaker in a clip's master and answers with the editor settings
 * that frame on them: a crop-fill punch-in when they carry the shot, or the
 * camera-lead layout with the detected camera region when they are a small
 * overlay on a screenshare. The editor applies the answer to the project, so
 * the preview and the export agree without a second detection pass.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!resolveFfmpeg()) {
    return NextResponse.json({ error: FFMPEG_MISSING_MESSAGE }, { status: 500 });
  }
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  let body: { file?: unknown; width?: unknown; height?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `file` field." }, { status: 400 });
  }
  const file = typeof body.file === "string" ? body.file : "";
  if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) {
    return NextResponse.json({ error: "Name the clip file to auto-frame." }, { status: 400 });
  }
  const filePath = path.join(outputDir(jobId), file);
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "That clip file no longer exists." }, { status: 404 });
  }

  const targetW = typeof body.width === "number" && body.width > 0 ? Math.round(body.width) : 1080;
  const targetH = typeof body.height === "number" && body.height > 0 ? Math.round(body.height) : 1920;
  const planned = await planClipFraming(filePath, { targetW, targetH });
  if (!planned) {
    return NextResponse.json({ error: "That clip could not be analysed." }, { status: 500 });
  }

  const { framing } = planned;
  const reframe = framingToReframe(framing, planned.target);
  if (framing.mode === "subject-fill" && reframe) {
    return NextResponse.json({
      mode: framing.mode,
      confidence: framing.confidence,
      reason: framing.reason,
      compositionMode: "crop-fill" as ClipCompositionMode,
      reframe
    });
  }
  if (framing.mode === "speaker-stack" && framing.faceSource && STACK_MODE) {
    return NextResponse.json({
      mode: framing.mode,
      confidence: framing.confidence,
      reason: framing.reason,
      compositionMode: STACK_MODE,
      faceSource: framing.faceSource
    });
  }
  return NextResponse.json({
    mode: "center-blur",
    confidence: framing.confidence,
    reason: framing.reason
  });
}
