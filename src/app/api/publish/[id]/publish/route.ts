import { NextResponse } from "next/server";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Instagram/TikTok processing can poll for a few minutes.
export const maxDuration = 300;

/**
 * POST /api/publish/:id/publish — push one queue item to its providers right
 * now (YouTube uploads immediately with status.publishAt; Instagram/TikTok
 * post immediately instead of waiting for their slot).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }
  const { id } = await params;
  const queue = publishQueue(config);
  if (!(await queue.get(id))) {
    return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  }
  const report = await runDue(new Date(), { itemId: id, force: true });
  const item = await queue.get(id);
  return NextResponse.json({ report, item });
}
