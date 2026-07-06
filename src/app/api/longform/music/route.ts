import { NextRequest, NextResponse } from "next/server";
import { listTracks, saveTrackFromStream } from "@/lib/longform/music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Songs stream to disk; allow time for large uploads.
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ tracks: await listTracks() });
}

/**
 * Uploads a song to the shared music library. Like the clips source upload,
 * the request body IS the file (no multipart) — the name arrives as a query
 * param and the type as the Content-Type header.
 */
export async function POST(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim() || "song.mp3";
  const type = request.headers.get("content-type") ?? "audio/mpeg";
  if (!request.body) {
    return NextResponse.json({ error: "Attach the audio file as the request body." }, { status: 400 });
  }
  try {
    const track = await saveTrackFromStream(request.body, name, type);
    return NextResponse.json({ track }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save that song." },
      { status: 500 }
    );
  }
}
