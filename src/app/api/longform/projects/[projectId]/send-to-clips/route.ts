import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { createJobFromUpload } from "@/lib/clipping/jobs";
import { saveSourceFromStream } from "@/lib/clipping/sources";
import { getProject, projectOutputDir } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Registering the export as a clips source copies a potentially large file.
export const maxDuration = 300;

/**
 * The all-in-one handoff: registers a finished long-form export as a new
 * clips source and starts a Clip Generator job on it, so the edited video
 * flows straight into shorts without a manual download/re-upload.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  let body: { exportId?: unknown; topic?: unknown; clipCount?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with an `exportId` field." }, { status: 400 });
  }
  const exportId = typeof body.exportId === "string" ? body.exportId : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const clipCount = typeof body.clipCount === "number" ? body.clipCount : undefined;
  const record = project.exports.find((item) => item.id === exportId);
  if (!record || record.status !== "done" || !record.file) {
    return NextResponse.json({ error: "That export has not finished rendering." }, { status: 409 });
  }

  const filePath = path.join(projectOutputDir(projectId), record.file);
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "The export file is missing. Export again." }, { status: 404 });
  }

  try {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
    const source = await saveSourceFromStream(stream, `${project.name} (edited).mp4`, "video/mp4");
    const job = await createJobFromUpload(source.id, topic || undefined, clipCount);
    return NextResponse.json({ job, source }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not send this export to the Clip Generator." },
      { status: 500 }
    );
  }
}
