import { z } from "zod";

export const INBOX_PLATFORMS = ["youtube", "instagram", "facebook", "threads"] as const;
export type InboxPlatform = (typeof INBOX_PLATFORMS)[number];

export const INBOX_STATUSES = ["new", "seen", "replied", "done"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const INBOX_PLATFORM_LABEL: Record<InboxPlatform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads"
};

export const MAX_INBOX_ITEMS = 5000;
export const DONE_RETENTION_DAYS = 60;
export const BACKFILL_UNREAD_DAYS = 14;

export const inboxItemSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(INBOX_PLATFORMS),
  accountId: z.string(),
  postId: z.string().min(1),
  postTitle: z.string(),
  postUrl: z.string().optional(),
  externalId: z.string().min(1),
  parentId: z.string().optional(),
  kind: z.enum(["comment", "reply", "mention"]),
  authorName: z.string(),
  text: z.string(),
  at: z.string(),
  permalink: z.string().optional(),
  status: z.enum(INBOX_STATUSES),
  statusAt: z.string(),
  fetchedAt: z.string(),
  source: z.enum(["poll", "webhook"]),
  reply: z
    .object({
      text: z.string(),
      sentAt: z.string(),
      externalId: z.string().optional()
    })
    .optional(),
  send: z
    .object({
      state: z.enum(["sending", "send-unknown"]),
      at: z.string(),
      text: z.string(),
      error: z.string().optional()
    })
    .optional()
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const postCursorSchema = z.object({
  newestAt: z.string().optional(),
  lastFetchedAt: z.string().optional(),
  lastActivityAt: z.string().optional(),
  permalink: z.string().optional()
});
export type PostCursor = z.infer<typeof postCursorSchema>;

export const platformSyncSchema = z.object({
  lastSyncAt: z.string().optional(),
  lastError: z.string().optional(),
  needs: z.enum(["scope", "auth"]).optional(),
  message: z.string().optional(),
  needsSince: z.string().optional(),
  connected: z.boolean().optional()
});
export type PlatformSyncState = z.infer<typeof platformSyncSchema>;

export const inboxStoreSchema = z.object({
  items: z.array(inboxItemSchema).default([]),
  cursors: z.record(postCursorSchema).default({}),
  platforms: z.record(platformSyncSchema).default({}),
  youtubeUnits: z.object({ date: z.string(), used: z.number() }).optional(),
  lastSyncAt: z.string().optional()
});
export type InboxStore = z.infer<typeof inboxStoreSchema>;

export function emptyInbox(): InboxStore {
  return { items: [], cursors: {}, platforms: {} };
}

export type PublishedPost = {
  platform: InboxPlatform;
  accountId: string;
  postId: string;
  title: string;
  publishedAt: string;
  url?: string;
};

export function cursorKey(platform: InboxPlatform, postId: string): string {
  return `${platform}:${postId}`;
}

export function reconnectMessage(platform: InboxPlatform, kind: "scope" | "auth"): string {
  const label = INBOX_PLATFORM_LABEL[platform];
  return kind === "scope" ? `Reconnect ${label} with comment permission` : `Reconnect ${label}`;
}
