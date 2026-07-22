import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { getProject, projectOutputDir, updateProject } from "@/lib/longform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  return name.replace(/[^a-z0-9 ._()-]+/gi, "_").slice(0, 120) || "edited-audio.mp3";
}

/**
 * Extracts an audio-only mp3 from a finished video export — the podcast /
 * Spotify version of the edit. The mp3 is cut from the rendered file itself,
 * so it carries the exact same cuts, hook and music mix as the video.
 * Idempotent: if the mp3 already exists it is reused.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ projectId: string; exportId: string }> }) {
  const { projectId, exportId } = await params;
  const project = await getProject(projectId);
  const record = project?.exports.find((item) => item.id === exportId);
  if (!project || !record) {
    return NextResponse.json({ error: "Export not found — it may have expired after a server restart." }, { status: 404 });
  }
  if (record.status !== "done" || !record.file) {
    return NextResponse.json({ error: "Export the video first — the audio version is cut from the finished render." }, { status: 409 });
  }

  const outputDir = projectOutputDir(projectId);
  const videoPath = path.join(outputDir, record.file);
  const audioName = record.file.replace(/\.[a-z0-9]+$/i, "") + ".mp3";
  const audioPath = path.join(outputDir, audioName);

  const exists = await stat(audioPath).then(() => true, () => false);
  if (!exists) {
    try {
      await runFfmpeg(["-y", "-i", videoPath, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", audioPath]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: `Audio extraction failed: ${message}` }, { status: 500 });
    }
  }

  record.audioFile = audioName;
  await updateProject(projectId, { exports: project.exports });
  return NextResponse.json({ export: record });
}

/** Serves the extracted mp3 (`?download=1` forces a file download). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string; exportId: string }> }) {
  const { projectId, exportId } = await params;
  const project = await getProject(projectId);
  const record = project?.exports.find((item) => item.id === exportId);
  if (!project || !record?.audioFile) {
    return NextResponse.json({ error: "No audio export yet — create it first." }, { status: 404 });
  }
  const filePath = path.join(projectOutputDir(projectId), record.audioFile);
  if (!path.resolve(filePath).startsWith(path.resolve(projectOutputDir(projectId)))) {
    return NextResponse.json({ error: "Audio file is invalid." }, { status: 400 });
  }
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "The audio file is missing. Create it again." }, { status: 404 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const name = safeFilename(`${project.name} (audio).mp3`);
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=3600",
      ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {})
    }
  });
}
