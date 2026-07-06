import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { deleteTrack, getTrack, openTrackRange, trackFilePath } from "@/lib/longform/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ trackId: string }> };

/** Streams a library song with Range support so <audio> can seek. */
export async function GET(request: NextRequest, { params }: Params) {
  const { trackId } = await params;
  const track = await getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track not found." }, { status: 404 });

  let size: number;
  try {
    size = (await stat(trackFilePath(track))).size;
  } catch {
    return NextResponse.json({ error: "Track file is missing." }, { status: 404 });
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
    const stream = Readable.toWeb(openTrackRange(track, start, end)) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": track.mime,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600"
      }
    });
  }

  const stream = Readable.toWeb(openTrackRange(track, 0, size - 1)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": track.mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600"
    }
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { trackId } = await params;
  const track = await getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track not found." }, { status: 404 });
  await deleteTrack(trackId);
  return NextResponse.json({ ok: true });
}
