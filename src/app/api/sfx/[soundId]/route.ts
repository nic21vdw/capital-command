import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteCustomSound,
  getCustomSound,
  isSfxSoundId,
  openSoundRange,
  resolveSoundPath,
  saveCustomSound
} from "@/lib/sfx/sounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Uploads stream to disk; give slow connections room.
export const maxDuration = 300;

type Params = { params: Promise<{ soundId: string }> };

/**
 * Streams the audio a slot currently plays — the uploaded replacement when
 * one exists, the synthesized stand-in otherwise — with Range support so
 * <audio> can seek during auditions.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { soundId } = await params;
  if (!isSfxSoundId(soundId)) return NextResponse.json({ error: "Unknown sound." }, { status: 404 });

  const custom = await getCustomSound(soundId);
  const filePath = await resolveSoundPath(soundId);
  if (!filePath) return NextResponse.json({ error: "No audio available for that sound." }, { status: 404 });
  const mime = custom ? custom.mime : "audio/wav";

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "Sound file is missing." }, { status: 404 });
  }

  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? Number(match[1]) : 0;
    let end = match && match[2] ? Number(match[2]) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(openSoundRange(filePath, start, end)) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      }
    });
  }

  const stream = Readable.toWeb(openSoundRange(filePath, 0, size - 1)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Uploads the real sound for a slot. Like the music library, the request
 * body IS the file — the name arrives as a query param and the type as the
 * Content-Type header.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { soundId } = await params;
  if (!isSfxSoundId(soundId)) return NextResponse.json({ error: "Unknown sound." }, { status: 404 });
  const name = request.nextUrl.searchParams.get("name")?.trim() || `${soundId}.mp3`;
  const type = request.headers.get("content-type") ?? "audio/mpeg";
  if (!request.body) {
    return NextResponse.json({ error: "Attach the audio file as the request body." }, { status: 400 });
  }
  try {
    const sound = await saveCustomSound(soundId, request.body, name, type);
    return NextResponse.json({ sound }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save that sound." },
      { status: 500 }
    );
  }
}

/** Removes the uploaded file so the slot falls back to its stand-in sound. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { soundId } = await params;
  if (!isSfxSoundId(soundId)) return NextResponse.json({ error: "Unknown sound." }, { status: 404 });
  await deleteCustomSound(soundId);
  return NextResponse.json({ ok: true });
}
