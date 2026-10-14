import { INBOX_PLATFORM_LABEL, type InboxItem, type InboxPlatform, type InboxStatus } from "@/lib/inbox/types";

export type StatusFilter = "open" | "all" | InboxStatus;
export type PlatformFilter = "all" | InboxPlatform;

export type PostGroup = {
  key: string;
  platform: InboxPlatform;
  postId: string;
  title: string;
  url?: string;
  items: InboxItem[];
  unread: number;
};

export function filterItems(items: InboxItem[], filter: { platform: PlatformFilter; status: StatusFilter }): InboxItem[] {
  return items.filter((item) => {
    if (filter.platform !== "all" && item.platform !== filter.platform) return false;
    if (filter.status === "all") return true;
    if (filter.status === "open") return item.status === "new" || item.status === "seen";
    return item.status === filter.status;
  });
}

export function groupByPost(items: InboxItem[]): PostGroup[] {
  const groups = new Map<string, PostGroup>();
  for (const item of items) {
    const key = `${item.platform}:${item.postId}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, platform: item.platform, postId: item.postId, title: item.postTitle, url: item.postUrl, items: [], unread: 0 };
      groups.set(key, group);
    }
    group.items.push(item);
    if (item.status === "new") group.unread += 1;
    if (!group.url && item.postUrl) group.url = item.postUrl;
  }
  const newest = (group: PostGroup) => Math.max(...group.items.map((item) => Date.parse(item.at)));
  return [...groups.values()].sort((a, b) => b.unread - a.unread || newest(b) - newest(a));
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function surfaceLine(item: InboxItem): string {
  const text = item.text.replace(/\s+/g, " ").trim();
  const clipped = text.length > 160 ? `${text.slice(0, 159)}…` : text;
  return `[${item.id}] ${INBOX_PLATFORM_LABEL[item.platform]} ${item.authorName} on "${item.postTitle}": ${clipped}`;
}
