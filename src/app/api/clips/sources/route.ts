import { NextRequest, NextResponse } from "next/server";
import { saveSourceFromStream } from "@/lib/clipping/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow large uploads to stream through without Next buffering the body.
export const maxDuration = 300;

/**
 * Accepts a raw video body (sent as `fetch(url, { body: file })`) and streams
 * it to disk. Filename/mime arrive as query params so we avoid multipart
 * parsing — which would otherwise buffer the whole file in memory.
 */
export async function POST(request: NextRequest) {
  if (!request.body) {
    return NextResponse.json({ error: "No file body received." }, { status: 400 });
  }

  const name = request.nextUrl.searchParams.get("name")?.trim() || "source.mp4";
  const type = request.headers.get("content-type") || "video/mp4";

  try {
    const meta = await saveSourceFromStream(request.body, name, type);
    return NextResponse.json({ source: meta }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 500 }
    );
  }
}
