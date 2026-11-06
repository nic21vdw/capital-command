import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_CHANNELS, REVIEW_MODES } from "@/lib/publisher/approval";
import { ReviewPolicyUnreadableError, readReviewPolicyState, updateReviewPolicy } from "@/lib/publisher/approvalStore";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { ReleaseUnplacedError } from "@/lib/publisher/release";
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
    threads: mode.optional(),
    linkedin: mode.optional()
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
  const now = new Date();
  try {
    const outcome = await updateReviewPolicy(change, now, async (current, commitPolicy) => {
      const opening = REVIEW_CHANNELS.filter((channel) => channel !== "threads" && current.policy[channel] === "hold" && change[channel] === "auto");
      if (opening.length === 0) return { policy: await commitPolicy(), released: { approved: 0, moved: [] } };
      const result = await publishQueue(publisherConfig()).releaseForPolicyChange(opening as PlatformId[], current.policy, current.heldSince, now, commitPolicy);
      return { policy: result.policy, released: {
        approved: result.approved,
        moved: result.moves.map((move) => ({ ...move, key: `${move.platform}:${move.id}` }))
      } };
    });
    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof ReviewPolicyUnreadableError || error instanceof ReleaseUnplacedError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
