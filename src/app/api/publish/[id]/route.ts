import { NextResponse } from "next/server";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/publish/:id — drop a scheduled post from the queue. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }
  const { id } = await params;
  const removed = await publishQueue(config).remove(id);
  if (!removed) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  return NextResponse.json({ removed: true });
}
