import { NextResponse } from "next/server";
import { publisherConfig } from "@/lib/publisher/config";
import { PUBLISHING_OFF_MESSAGE } from "@/lib/publisher/enabled";
import { publishQueue } from "@/lib/publisher/queue";
import { runDue } from "@/lib/publisher/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Instagram/TikTok processing can poll for a few minutes.
export const maxDuration = 300;

/**
 * POST /api/publish/:id/publish — push one queue item to its providers.
 *
 * `{ "mode": "now" }`: "Publish now" means now. Every platform not yet
 * finished posts immediately, and a YouTube video held for its slot is made
 * public. Only the board's confirmed Publish now sends this, and it must say so
 * explicitly: a forced run publishes early, so it is never the default.
 *
 * `{ "mode": "slot" }`, no body, or any other mode: what Retry sends after
 * re-arming a leg. The run is scoped to this post but NOT forced, so a slot
 * that has passed posts now, a future slot keeps waiting, and the post's other
 * platforms are left alone.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: PUBLISHING_OFF_MESSAGE }, { status: 400 });
  }
  const { id } = await params;
  const queue = publishQueue(config);
  if (!(await queue.get(id))) {
    return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
  }
  let mode: unknown;
  try {
    mode = ((await request.json()) as { mode?: unknown } | null)?.mode;
  } catch {
    // No body: the safe slot mode below.
  }
  const report = await runDue(new Date(), { itemId: id, force: mode === "now" });
  const item = await queue.get(id);
  return NextResponse.json({ report, item });
}
