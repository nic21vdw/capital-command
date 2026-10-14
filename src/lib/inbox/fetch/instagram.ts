import { handle, newItem, MAX_PAGES, type FetchOptions, type FetchResult } from "@/lib/inbox/fetch/common";
import { isNewer, laterOf, toIso } from "@/lib/inbox/time";
import type { InboxItem, PublishedPost } from "@/lib/inbox/types";
import { fetchJson } from "@/lib/publisher/http";

export type InstagramAuth = { accessToken: string; graphApiVersion: string; selfUsername: string | null };

type InstagramComment = { id?: string; text?: string; timestamp?: string; username?: string };
type InstagramThread = InstagramComment & { replies?: { data?: InstagramComment[] } };
type InstagramResponse = { data?: InstagramThread[]; paging?: { cursors?: { after?: string }; next?: string } };

const FIELDS = "id,text,timestamp,username,replies.limit(25){id,text,timestamp,username}";

function commentLink(permalink: string | undefined, commentId: string): string | undefined {
  return permalink ? `${permalink.replace(/\/?$/, "/")}c/${commentId}/` : undefined;
}

export async function fetchInstagramComments(
  post: PublishedPost,
  since: string | null,
  auth: InstagramAuth,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const now = options.now ?? new Date();
  const maxPages = options.maxPages ?? MAX_PAGES;
  const base = `https://graph.facebook.com/${auth.graphApiVersion}`;
  const items: InboxItem[] = [];
  let newestAt: string | null = null;
  let after: string | undefined;
  let pages = 0;
  let permalink = post.url;

  const resolvePermalink = async () => {
    if (permalink) return;
    const query = new URLSearchParams({ fields: "permalink", access_token: auth.accessToken });
    const media = await fetchJson<{ permalink?: string }>(`${base}/${encodeURIComponent(post.postId)}?${query}`, {
      label: "Instagram media",
      method: "GET"
    }).catch((): { permalink?: string } => ({}));
    permalink = media.permalink;
  };

  while (pages < maxPages) {
    const query = new URLSearchParams({ fields: FIELDS, limit: "50", access_token: auth.accessToken });
    if (after) query.set("after", after);
    const data = await fetchJson<InstagramResponse>(`${base}/${encodeURIComponent(post.postId)}/comments?${query}`, {
      label: "Instagram comments",
      method: "GET"
    });
    pages += 1;

    const found: Array<{ comment: InstagramComment & { id: string }; at: string; parentId?: string }> = [];
    let reachedKnown = false;
    for (const thread of data.data ?? []) {
      const at = toIso(thread.timestamp);
      if (thread.id && at) {
        newestAt = laterOf(newestAt, at);
        if (!isNewer(at, since)) reachedKnown = true;
        else if (thread.username !== auth.selfUsername) found.push({ comment: { ...thread, id: thread.id }, at });
      }
      for (const reply of thread.replies?.data ?? []) {
        const replyAt = toIso(reply.timestamp);
        if (!reply.id || !replyAt) continue;
        newestAt = laterOf(newestAt, replyAt);
        if (isNewer(replyAt, since) && reply.username !== auth.selfUsername) {
          found.push({ comment: { ...reply, id: reply.id }, at: replyAt, parentId: thread.id });
        }
      }
    }

    if (found.length > 0) await resolvePermalink();
    for (const { comment, at, parentId } of found) {
      items.push(
        newItem(
          post,
          {
            externalId: comment.id,
            kind: parentId ? "reply" : "comment",
            authorName: handle(comment.username),
            text: comment.text ?? "(no text)",
            at,
            parentId,
            permalink: commentLink(permalink, comment.id)
          },
          now
        )
      );
    }

    const next = data.paging?.next ? data.paging.cursors?.after : undefined;
    if (reachedKnown || !next) break;
    after = next;
  }

  return { items, newestAt, pages, ...(permalink ? { permalink } : {}) };
}
