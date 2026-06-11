import { NextRequest, NextResponse } from "next/server";
import { deleteJob, getJob } from "@/lib/clipping/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  return NextResponse.json({ job });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (job.status === "processing" || job.status === "queued") {
    return NextResponse.json({ error: "This job is still processing — wait for it to finish first." }, { status: 409 });
  }
  await deleteJob(jobId);
  return NextResponse.json({ ok: true });
}
