import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_CHANNELS, REVIEW_MODES } from "@/lib/publisher/approval";
import { ReviewPolicyUnreadableError, readReviewPolicyState, writeReviewPolicy } from "@/lib/publisher/approvalStore";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import type { ReleaseMove } from "@/lib/publisher/release";
import type { PlatformId } from "@/lib/publisher/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mode = z.enum(REVIEW_MODES);

const changeSchema = z
  .object({
    youtube: mode.optional(),
    instagram: mode.optional(),
    tiktok: mode.optional(),
    facebook: mode.optional(),
    threads: mode.optional()
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, "Name at least one channel.");

export async function GET() {
  return NextResponse.json(readReviewPolicyState());
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body naming channels and auto or hold." }, { status: 400 });
  }
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const change = parsed.data;
  const current = readReviewPolicyState();
  if (current.error) return NextResponse.json({ error: current.error }, { status: 409 });
  const before = current.policy;
  const now = new Date();
  const released = { approved: 0, moved: [] as Array<ReleaseMove & { key: string }> };
  try {
    const opening = REVIEW_CHANNELS.filter((channel) => channel !== "threads" && before[channel] === "hold" && change[channel] === "auto");
    for (const channel of opening) {
      const result = await publishQueue(publisherConfig()).releaseAwaiting(now, channel as PlatformId, before, current.heldSince[channel]);
      released.approved += result.approved;
      released.moved.push(...result.moves.map((move) => ({ ...move, key: `${move.platform}:${move.id}` })));
      if (result.skipped.length > 0) {
        return NextResponse.json(
          {
            error: `${result.skipped.length} held post${result.skipped.length === 1 ? " has" : "s have"} no free slot left to go to, so ${channel} stays on hold. Approve or remove ${result.skipped.length === 1 ? "it" : "them"} first.`
          },
          { status: 409 }
        );
      }
    }
    return NextResponse.json({ policy: await writeReviewPolicy(change), released });
  } catch (error) {
    if (error instanceof ReviewPolicyUnreadableError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
