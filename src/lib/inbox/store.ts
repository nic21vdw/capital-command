import { createJsonStore } from "@/lib/storage/json-store";
import {
  BACKFILL_UNREAD_DAYS,
  DONE_RETENTION_DAYS,
  MAX_INBOX_ITEMS,
  cursorKey,
  emptyInbox,
  inboxStoreSchema,
  type InboxItem,
  type InboxPlatform,
  type InboxStatus,
  type InboxStore
} from "@/lib/inbox/types";
import { laterOf } from "@/lib/inbox/time";

const DAY_MS = 86_400_000;

const store = createJsonStore("inbox.json", inboxStoreSchema, emptyInbox());

export const readInbox = (): Promise<InboxStore> => store.read();
export const updateInbox = (mutate: (value: InboxStore) => InboxStore | Promise<InboxStore>): Promise<InboxStore> =>
  store.update(mutate);

function newestFirst(a: InboxItem, b: InboxItem): number {
  return Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id);
}

export function applyCap(items: InboxItem[], now: Date, options: { max?: number } = {}): InboxItem[] {
  const max = options.max ?? MAX_INBOX_ITEMS;
  const cutoff = now.getTime() - DONE_RETENTION_DAYS * DAY_MS;
  let kept = items.filter((item) => !(item.status === "done" && Date.parse(item.statusAt) < cutoff));
  if (kept.length > max) {
    const open = kept.filter((item) => item.status !== "done").sort(newestFirst);
    const done = kept.filter((item) => item.status === "done").sort(newestFirst);
    kept = [...open, ...done].slice(0, max);
  }
  return kept.sort(newestFirst);
}

export function mergeIncoming(current: InboxStore, incoming: InboxItem[], now: Date): InboxStore {
  const answered = new Set(current.items.flatMap((item) => (item.reply?.externalId ? [item.reply.externalId] : [])));
  const byId = new Map(current.items.map((item) => [item.id, item]));
  const staleBefore = now.getTime() - BACKFILL_UNREAD_DAYS * DAY_MS;
  const stamp = now.toISOString();

  for (const item of incoming) {
    if (answered.has(item.externalId)) continue;
    const existing = byId.get(item.id);
    if (existing) {
      byId.set(item.id, {
        ...existing,
        text: item.text,
        authorName: item.authorName,
        postTitle: item.postTitle,
        ...(item.postUrl ? { postUrl: item.postUrl } : {}),
        ...(item.permalink ? { permalink: item.permalink } : {})
      });
      continue;
    }
    const history = item.source === "poll" && Date.parse(item.at) < staleBefore;
    byId.set(item.id, { ...item, status: history ? "seen" : "new", statusAt: stamp });
  }

  return { ...current, items: applyCap([...byId.values()], now) };
}

export function setItemStatus(current: InboxStore, id: string, status: InboxStatus, now: Date): InboxStore {
  if (!current.items.some((item) => item.id === id)) throw new Error(`${id} is not in the inbox.`);
  return {
    ...current,
    items: current.items.map((item) => (item.id === id ? { ...item, status, statusAt: now.toISOString() } : item))
  };
}

export function markAllSeen(current: InboxStore, now: Date, filter: { platform?: InboxPlatform } = {}): InboxStore {
  const stamp = now.toISOString();
  return {
    ...current,
    items: current.items.map((item) =>
      item.status === "new" && (!filter.platform || item.platform === filter.platform)
        ? { ...item, status: "seen", statusAt: stamp }
        : item
    )
  };
}

export function recordReply(
  current: InboxStore,
  id: string,
  reply: { text: string; externalId?: string },
  now: Date
): InboxStore {
  if (!current.items.some((item) => item.id === id)) throw new Error(`${id} is not in the inbox.`);
  const stamp = now.toISOString();
  return {
    ...current,
    items: current.items.map((item) =>
      item.id === id ? { ...item, status: "replied", statusAt: stamp, reply: { ...reply, sentAt: stamp } } : item
    )
  };
}

export function noteActivity(current: InboxStore, platform: InboxPlatform, postId: string, at: string): InboxStore {
  const key = cursorKey(platform, postId);
  const cursor = current.cursors[key] ?? {};
  return { ...current, cursors: { ...current.cursors, [key]: { ...cursor, lastActivityAt: laterOf(cursor.lastActivityAt ?? null, at) } } };
}

export function unreadCount(current: InboxStore): number {
  return current.items.filter((item) => item.status === "new").length;
}

export function statusCounts(current: InboxStore): Record<InboxStatus, number> {
  const counts: Record<InboxStatus, number> = { new: 0, seen: 0, replied: 0, done: 0 };
  for (const item of current.items) counts[item.status] += 1;
  return counts;
}
