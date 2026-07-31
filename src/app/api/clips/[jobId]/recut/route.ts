import { NextRequest, NextResponse } from "next/server";
import { recutClip } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Moves one clip's in/out points inside its source stream and re-cuts it.
 * Returns as soon as the render is under way — the job comes back marked
 * processing and the Clip Generator polls it to completion.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  let body: { clipId?: string; start?: number; end?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.clipId || typeof body.start !== "number" || typeof body.end !== "number") {
    return NextResponse.json({ error: "Send a clipId with start and end times in seconds." }, { status: 400 });
  }
  try {
    const job = await recutClip(jobId, { clipId: body.clipId, start: body.start, end: body.end });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    // The caller drops this straight into the job list it already holds, and a
    // multi-hour word-level transcript has no business riding along with a
    // render kick-off — it has its own endpoint.
    const light = { ...job };
    delete light.sourceCaptions;
    return NextResponse.json({ job: light });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not re-cut that clip." },
      { status: 409 }
    );
  }
}
