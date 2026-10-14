import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markAllSeen, readInbox, setItemStatus, statusCounts, unreadCount, updateInbox } from "@/lib/inbox/store";
import { syncInbox } from "@/lib/inbox/sync";
import { INBOX_PLATFORMS, INBOX_STATUSES, type InboxPlatform, type InboxStatus, type InboxStore } from "@/lib/inbox/types";
import { allowsRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_LIMIT = 1000;

function failure(error: unknown, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

function refuseForeignOrigin(request: NextRequest) {
  return allowsRequestOrigin(request)
    ? null
    : NextResponse.json({ error: "The inbox can only be changed from this app." }, { status: 403 });
}

function unreadByPlatform(store: InboxStore): Record<InboxPlatform, number> {
  const counts = Object.fromEntries(INBOX_PLATFORMS.map((platform) => [platform, 0])) as Record<InboxPlatform, number>;
  for (const item of store.items) if (item.status === "new") counts[item.platform] += 1;
  return counts;
}

export async function GET(request: NextRequest) {
  try {
    const store = await readInbox();
    const params = request.nextUrl.searchParams;
    const summary = {
      unread: unreadCount(store),
      unreadByPlatform: unreadByPlatform(store),
      platforms: store.platforms,
      lastSyncAt: store.lastSyncAt ?? null
    };
    if (params.get("summary")) return NextResponse.json(summary);

    const platform = params.get("platform");
    const status = params.get("status");
    const limit = Math.min(5000, Math.max(1, Number(params.get("limit")) || DEFAULT_LIMIT));
    const items = store.items
      .filter((item) => !platform || platform === "all" || item.platform === platform)
      .filter((item) => !status || status === "all" || item.status === status)
      .slice(0, limit);
    return NextResponse.json({ ...summary, items, counts: statusCounts(store) });
  } catch (error) {
    return failure(error);
  }
}

const postSchema = z.union([
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("markAllSeen"), platform: z.enum(INBOX_PLATFORMS).optional() })
]);

export async function POST(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Send { action: "sync" } or { action: "markAllSeen" }.' }, { status: 400 });
  try {
    if (parsed.data.action === "sync") return NextResponse.json(await syncInbox({ force: true }));
    const { platform } = parsed.data;
    const store = await updateInbox((current) => markAllSeen(current, new Date(), { platform }));
    return NextResponse.json({ unread: unreadCount(store) });
  } catch (error) {
    return failure(error);
  }
}

const patchSchema = z.object({ id: z.string().min(1), status: z.enum(INBOX_STATUSES) });

export async function PATCH(request: NextRequest) {
  const refused = refuseForeignOrigin(request);
  if (refused) return refused;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { id, status } with status new, seen, replied or done." }, { status: 400 });
  const { id, status } = parsed.data as { id: string; status: InboxStatus };
  try {
    const store = await updateInbox((current) => setItemStatus(current, id, status, new Date()));
    return NextResponse.json({ unread: unreadCount(store), item: store.items.find((item) => item.id === id) });
  } catch (error) {
    return failure(error, /not in the inbox/.test(error instanceof Error ? error.message : "") ? 404 : 500);
  }
}
