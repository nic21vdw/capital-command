import { NextRequest, NextResponse } from "next/server";
import { fetchJobCaptions, getJob } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns cached source captions for a job, if any have been fetched. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json({
    captions: job.sourceCaptions ?? [],
    fetchedAt: job.captionsFetchedAt ?? null,
    error: job.captionsError ?? null
  });
}

/** Fetches automatic captions for a job. `?force=1` regenerates them. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const force = request.nextUrl.searchParams.get("force") === "1";
  const job = await fetchJobCaptions(jobId, force);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.captionsError && (!job.sourceCaptions || job.sourceCaptions.length === 0)) {
    return NextResponse.json({ error: job.captionsError }, { status: 422 });
  }
  return NextResponse.json({
    captions: job.sourceCaptions ?? [],
    fetchedAt: job.captionsFetchedAt ?? null,
    error: job.captionsError ?? null
  });
}
