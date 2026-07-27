import { NextRequest, NextResponse } from "next/server";
import { saveSourceFromStream } from "@/lib/clipping/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow large uploads to stream through without Next buffering the body.
// Sized for multi-hour stream VODs (tens of GB) arriving over a slow uplink;
// self-hosted Node ignores this, but managed hosts enforce it per-request.
export const maxDuration = 3600;

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
