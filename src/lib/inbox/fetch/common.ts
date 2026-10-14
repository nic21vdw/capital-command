import type { InboxItem, PublishedPost } from "@/lib/inbox/types";

export const MAX_PAGES = 5;

export type FetchResult = {
  items: InboxItem[];
  newestAt: string | null;
  pages: number;
  permalink?: string;
};

export type FetchOptions = {
  now?: Date;
  maxPages?: number;
};

type ItemFields = Pick<InboxItem, "externalId" | "kind" | "authorName" | "text" | "at"> &
  Partial<Pick<InboxItem, "parentId" | "permalink">>;

export function newItem(post: PublishedPost, fields: ItemFields, now: Date): InboxItem {
  const stamp = now.toISOString();
  return {
    id: `${post.platform}:${fields.externalId}`,
    platform: post.platform,
    accountId: post.accountId,
    postId: post.postId,
    postTitle: post.title,
    ...(post.url ? { postUrl: post.url } : {}),
    externalId: fields.externalId,
    ...(fields.parentId ? { parentId: fields.parentId } : {}),
    kind: fields.kind,
    authorName: fields.authorName,
    text: fields.text,
    at: fields.at,
    ...(fields.permalink ? { permalink: fields.permalink } : {}),
    status: "new",
    statusAt: stamp,
    fetchedAt: stamp,
    source: "poll"
  };
}

export function handle(username: unknown): string {
  return typeof username === "string" && username ? `@${username}` : "Someone";
}
