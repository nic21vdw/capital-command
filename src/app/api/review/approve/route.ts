import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_CHANNELS, type ReviewChannel } from "@/lib/publisher/approval";
import { readReviewPolicy } from "@/lib/publisher/approvalStore";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import type { PlatformId } from "@/lib/publisher/types";
import { approveItems, mutateQueue } from "@/lib/threads/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channel = z.enum(REVIEW_CHANNELS);

const bodySchema = z.union([
  z.object({ channel, id: z.string().min(1) }).strict(),
  z.object({ all: z.literal(true), channel: channel.optional() }).strict()
]);

async function approveThreads(filter: { id?: string }, now: Date) {
  const policy = readReviewPolicy();
  return mutateQueue((items) => {
    const result = approveItems(items, filter, now, policy);
    return { items: result.items, result };
  });
}

async function approveEverything(only: ReviewChannel | undefined, now: Date) {
  let approved = 0;
  if (only !== "threads") {
    approved += await publishQueue(publisherConfig()).approveAwaiting(now, only as PlatformId | undefined);
  }
  if (only === undefined || only === "threads") {
    approved += (await approveThreads({}, now)).changed;
  }
  return approved;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a channel and a post id, or all." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const now = new Date();
  try {
    if ("all" in parsed.data) {
      return NextResponse.json({ approved: await approveEverything(parsed.data.channel, now) });
    }
    const { channel: target, id } = parsed.data;
    if (target === "threads") {
      const result = await approveThreads({ id }, now);
      if (result.error) return NextResponse.json({ error: result.error }, { status: result.error.startsWith("No such") ? 404 : 409 });
      return NextResponse.json({ approved: result.changed });
    }
    const queue = publishQueue(publisherConfig());
    const item = await queue.get(id);
    if (!item?.platforms[target]) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
    return NextResponse.json({ approved: await queue.approveLegs([{ id, platform: target }], now) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
