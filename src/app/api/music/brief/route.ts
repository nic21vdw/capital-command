import { NextRequest, NextResponse } from "next/server";
import { writeSongBrief } from "@/lib/music/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turns a one-line idea into a model-ready prompt (title, style tags, prompt).
 * Falls back to the local heuristic when the AI gateway is unavailable, so the
 * "Write it for me" button always returns something usable.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { idea?: string } | null;
  const idea = body?.idea?.trim() ?? "";
  if (!idea) return NextResponse.json({ error: "Describe the idea first." }, { status: 400 });
  return NextResponse.json({ brief: await writeSongBrief(idea) });
}
