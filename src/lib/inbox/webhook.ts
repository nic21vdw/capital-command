import { listPublishedPosts } from "@/lib/inbox/posts";
import { mergeIncoming, noteActivity, updateInbox } from "@/lib/inbox/store";
import type { InboxItem } from "@/lib/inbox/types";

type CommentValue = {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
};
type MentionValue = { comment_id?: string; media_id?: string };
type Change = { field?: string; value?: CommentValue & MentionValue };
type Entry = { id?: string; time?: number; changes?: Change[] };
type Payload = { object?: string; entry?: Entry[] };

const COMMENT_FIELDS = new Set(["comments", "live_comments"]);

function isPayload(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && Array.isArray((value as Payload).entry);
}

export function instagramEventItems(payload: unknown, now: Date): InboxItem[] {
  if (!isPayload(payload)) return [];
  const stamp = now.toISOString();
  const items: InboxItem[] = [];

  for (const entry of payload.entry ?? []) {
    const at = typeof entry.time === "number" ? new Date(entry.time * 1000).toISOString() : stamp;
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const base = {
        platform: "instagram" as const,
        accountId: "instagram-primary",
        postTitle: "Instagram post",
        at,
        status: "new" as const,
        statusAt: stamp,
        fetchedAt: stamp,
        source: "webhook" as const
      };

      if (change.field && COMMENT_FIELDS.has(change.field)) {
        if (!value.id || !value.media?.id) continue;
        if (value.from?.id && value.from.id === entry.id) continue;
        items.push({
          ...base,
          id: `instagram:${value.id}`,
          externalId: value.id,
          postId: value.media.id,
          ...(value.parent_id ? { parentId: value.parent_id } : {}),
          kind: value.parent_id ? "reply" : "comment",
          authorName: value.from?.username ? `@${value.from.username}` : "Someone",
          text: value.text ?? "(no text)"
        });
      } else if (change.field === "mentions") {
        if (!value.comment_id || !value.media_id) continue;
        items.push({
          ...base,
          id: `instagram:mention:${value.comment_id}`,
          externalId: value.comment_id,
          postId: value.media_id,
          kind: "mention",
          authorName: "Someone",
          text: "Mentioned your account in a comment"
        });
      }
    }
  }
  return items;
}

export async function ingestInstagramEvent(payload: unknown, now: Date = new Date()): Promise<number> {
  const items = instagramEventItems(payload, now);
  if (items.length === 0) return 0;

  const known = new Map(
    (await listPublishedPosts().catch(() => [])).filter((post) => post.platform === "instagram").map((post) => [post.postId, post])
  );
  const named = items.map((item) => {
    const post = known.get(item.postId);
    return post ? { ...item, postTitle: post.title, accountId: post.accountId } : item;
  });

  let added = 0;
  await updateInbox((current) => {
    const ids = new Set(current.items.map((item) => item.id));
    added = named.filter((item) => !ids.has(item.id)).length;
    let next = mergeIncoming(current, named, now);
    for (const item of named) next = noteActivity(next, "instagram", item.postId, item.at);
    return next;
  });
  return added;
}
