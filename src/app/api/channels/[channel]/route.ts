import { NextRequest, NextResponse } from "next/server";
import {
  eventTargetsChannel,
  isChannelId,
  sortEvents,
  type ChannelAccount,
  type ChannelId,
  type ChannelResponse
} from "@/lib/channels/platforms";
import { buildMasterCalendarEvents, todayKeyIn } from "@/lib/master-calendar/aggregate";
import { accountIdConfigured, listAccounts } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { youtubeChannelInfo } from "@/lib/publisher/googleAuth";
import { FACEBOOK_SCOPE_BLOCKER, facebookCanPublish, facebookProfile, instagramProfile } from "@/lib/publisher/metaProfile";
import { TIKTOK_AUDIT_BLOCKER, tiktokCreatorInfo } from "@/lib/publisher/tiktokAuth";
import { readAppData } from "@/lib/storage/store";
import { threadsBlockedReason, threadsConfig, threadsConfigured } from "@/lib/threads/config";
import { readQueue } from "@/lib/threads/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A month grid is 42 cells; leave headroom without allowing huge scans. */
const MAX_DAYS = 62;

type Standing = { connected: number; blocker: string | null; account: ChannelAccount | null };

/**
 * Who this network posts as and whether it can. The four publish-queue
 * platforms answer through the same helpers the Uploading Center uses;
 * Threads answers from the autopilot's own config, since its accounts live
 * outside the publisher.
 */
async function standingFor(channel: ChannelId): Promise<Standing> {
  if (channel === "threads") {
    const config = threadsConfig();
    const accounts = config.accounts;
    const lead = accounts[0];
    return {
      connected: threadsConfigured(config) ? accounts.length : 0,
      blocker: threadsBlockedReason(config),
      account: lead ? { title: lead.label, handle: null, thumbnail: null } : null
    };
  }

  const all = await listAccounts();
  const onPlatform = all.filter((account) => account.platform === channel);
  const signedIn: typeof onPlatform = [];
  for (const account of onPlatform) {
    if (await accountIdConfigured(channel, account.id)) signedIn.push(account);
  }
  if (signedIn.length === 0) return { connected: 0, blocker: null, account: null };

  if (channel === "youtube") {
    const info = await youtubeChannelInfo(signedIn[0].id);
    return { connected: signedIn.length, blocker: null, account: info ?? null };
  }
  if (channel === "tiktok") {
    return {
      connected: signedIn.length,
      blocker: publisherConfig().tiktok.audited ? null : TIKTOK_AUDIT_BLOCKER,
      account: (await tiktokCreatorInfo()) ?? null
    };
  }
  if (channel === "instagram") {
    return { connected: signedIn.length, blocker: null, account: (await instagramProfile()) ?? null };
  }
  return {
    connected: signedIn.length,
    blocker: (await facebookCanPublish()) ? null : FACEBOOK_SCOPE_BLOCKER,
    account: (await facebookProfile()) ?? null
  };
}

/**
 * GET /api/channels/<channel>?start=YYYY-MM-DD&days=42 — one network's whole
 * scheduled output for a window: its short clips, long-form videos, carousels
 * and text posts, plus who it posts as. Nothing here is a new content store —
 * it is the Master Calendar's aggregate narrowed to a single network, with the
 * Threads autopilot's live queue standing in for its suggested pack.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  const { channel } = await context.params;
  if (!isChannelId(channel)) {
    return NextResponse.json({ error: `Unknown channel "${channel}".` }, { status: 404 });
  }

  const config = publisherConfig();
  const startRaw = request.nextUrl.searchParams.get("start");
  const daysRaw = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), MAX_DAYS) : 42;
  const startKey = startRaw && DATE_KEY_RE.test(startRaw) ? startRaw : todayKeyIn(config.timezone);

  const [data, queueItems, standing, threadsItems] = await Promise.all([
    readAppData(),
    // Same gate as GET /api/publish: with the publisher off the queue file is
    // not consulted, so every surface agrees on what is scheduled.
    config.enabled ? publishQueue(config).list() : Promise.resolve([]),
    standingFor(channel),
    channel === "threads" ? readQueue() : Promise.resolve([])
  ]);

  const all = buildMasterCalendarEvents({
    data,
    queueItems,
    threadsItems,
    timeZone: config.timezone,
    startKey,
    days
  });
  const events = sortEvents(all.filter((event) => eventTargetsChannel(event, channel)));

  const body: ChannelResponse = {
    channel,
    timezone: config.timezone,
    start: startKey,
    days,
    connected: standing.connected,
    blocker: standing.blocker,
    account: standing.account,
    events
  };
  return NextResponse.json(body);
}
