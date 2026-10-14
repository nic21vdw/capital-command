import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_CHANNELS, isReviewChannel, legAwaitingApproval, type ReviewChannel } from "@/lib/publisher/approval";
import { readReviewPolicy } from "@/lib/publisher/approvalStore";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import type { ReleaseMove } from "@/lib/publisher/release";
import type { PlatformId } from "@/lib/publisher/types";
import { approveItems, mutateQueue } from "@/lib/threads/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channel = z.enum(REVIEW_CHANNELS);

const bodySchema = z.union([
  z.object({ channel, id: z.string().min(1) }).strict(),
  z.object({ keys: z.array(z.string().min(1)).min(1).max(500) }).strict()
]);

type Entry = { channel: ReviewChannel; id: string };

function entryFromKey(key: string): Entry | null {
  const split = key.indexOf(":");
  if (split < 0) return null;
  const head = key.slice(0, split);
  const id = key.slice(split + 1);
  return isReviewChannel(head) && id ? { channel: head, id } : null;
}

async function approveEntries(entries: Entry[], now: Date) {
  const policy = readReviewPolicy();
  let approved = 0;
  const moved: Array<{ key: string; publishAt: string; reason: ReleaseMove["reason"] }> = [];
  const unplaced: string[] = [];

  const publisherEntries = entries.filter((entry) => entry.channel !== "threads");
  if (publisherEntries.length > 0) {
    const queue = publishQueue(publisherConfig());
    const targets: Array<{ id: string; platform: PlatformId }> = [];
    for (const entry of publisherEntries) {
      const platform = entry.channel as PlatformId;
      const leg = (await queue.get(entry.id))?.platforms[platform];
      if (leg && legAwaitingApproval(leg, platform, policy)) targets.push({ id: entry.id, platform });
    }
    if (targets.length > 0) {
      const result = await queue.releaseLegs(targets, now);
      approved += result.approved;
      moved.push(...result.moves.map((move) => ({ key: `${move.platform}:${move.id}`, publishAt: move.publishAt, reason: move.reason })));
      unplaced.push(...result.skipped.map((skipped) => `${skipped.platform}:${skipped.id}`));
    }
  }

  const threadsIds = entries.filter((entry) => entry.channel === "threads").map((entry) => entry.id);
  if (threadsIds.length > 0) {
    const result = await mutateQueue((items) => {
      const outcome = approveItems(items, { ids: threadsIds }, now, policy);
      return { items: outcome.items, result: outcome };
    });
    approved += result.changed;
  }
  return { approved, moved, unplaced };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a channel and a post id, or the keys to approve." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const now = new Date();
  try {
    if ("keys" in parsed.data) {
      const entries = parsed.data.keys.map(entryFromKey).filter((entry): entry is Entry => entry !== null);
      return NextResponse.json(await approveEntries(entries, now));
    }
    const { channel: target, id } = parsed.data;
    if (target === "threads") {
      const result = await mutateQueue((items) => {
        const outcome = approveItems(items, { id }, now, readReviewPolicy());
        return { items: outcome.items, result: outcome };
      });
      if (result.error) return NextResponse.json({ error: result.error }, { status: result.error.startsWith("No such") ? 404 : 409 });
      return NextResponse.json({ approved: result.changed, moved: [], unplaced: [] });
    }
    const item = await publishQueue(publisherConfig()).get(id);
    if (!item?.platforms[target]) return NextResponse.json({ error: "No such scheduled post." }, { status: 404 });
    return NextResponse.json(await approveEntries([{ channel: target, id }], now));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
