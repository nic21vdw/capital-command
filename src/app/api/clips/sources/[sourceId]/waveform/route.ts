import { NextResponse } from "next/server";
import { getWaveform, readSourceMeta } from "@/lib/clipping/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Returns cached/normalized waveform peaks for a source (empty array if none). */
export async function GET(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const meta = await readSourceMeta(sourceId);
  if (!meta) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }
  try {
    const peaks = await getWaveform(meta);
    return NextResponse.json({ peaks });
  } catch {
    return NextResponse.json({ peaks: [] });
  }
}
