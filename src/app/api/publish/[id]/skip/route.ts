import { NextResponse } from "next/server";
import { z } from "zod";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { applySkip, skipRefusal } from "@/lib/publisher/revise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const skipSchema = z.object({
  /** Which platforms to skip; absent means every one still waiting. */
  platforms: z.array(z.enum(["youtube", "instagram", "tiktok", "facebook"])).optional(),
  reason: z.string().max(200).optional()
});

/**
 * POST /api/publish/:id/skip — take a post out of the running without deleting
 * it. The record stays on the day so the schedule still shows what was
 * planned, but the runner never posts it (skipped is terminal). This is the
 * queue's version of the Threads autopilot's skip, and it exists because
 * "delete it" was previously the only way to stop a post, which loses the clip
 * and the copy along with it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = publisherConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Publishing is disabled. Set PUBLISH_ENABLED=true in .env." }, { status: 400 });
  }

  let body: z.infer<typeof skipSchema> = {};
  try {
    const raw = await request.text();
    body = raw ? skipSchema.parse(JSON.parse(raw)) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const queue = publishQueue(config);
  const { id } = await params;
  const item = await queue.get(id);
  if (!item) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });

  const refusal = skipRefusal(item, body.platforms);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  const skipped = applySkip(item, body.platforms, body.reason);
  await queue.add(skipped);
  return NextResponse.json({ item: skipped });
}
