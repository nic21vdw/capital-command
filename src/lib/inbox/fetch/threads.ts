import { handle, newItem, MAX_PAGES, type FetchOptions, type FetchResult } from "@/lib/inbox/fetch/common";
import { isNewer, laterOf, toIso } from "@/lib/inbox/time";
import type { InboxItem, PublishedPost } from "@/lib/inbox/types";
import { fetchJson } from "@/lib/publisher/http";

export type ThreadsAuth = { accessToken: string; apiBase: string; apiVersion: string; selfUsername: string | null };

type ThreadsReply = { id?: string; text?: string; username?: string; timestamp?: string; permalink?: string };
type ThreadsResponse = { data?: ThreadsReply[]; paging?: { cursors?: { after?: string }; next?: string } };

const FIELDS = "id,text,username,timestamp,permalink,has_replies";

export async function fetchThreadsReplies(
  post: PublishedPost,
  since: string | null,
  auth: ThreadsAuth,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const now = options.now ?? new Date();
  const maxPages = options.maxPages ?? MAX_PAGES;
  const items: InboxItem[] = [];
  let newestAt: string | null = null;
  let after: string | undefined;
  let pages = 0;
  let complete = false;

  while (pages < maxPages) {
    const query = new URLSearchParams({ fields: FIELDS, reverse: "true", limit: "50" });
    if (after) query.set("after", after);
    const data = await fetchJson<ThreadsResponse>(
      `${auth.apiBase}/${auth.apiVersion}/${encodeURIComponent(post.postId)}/replies?${query}`,
      { label: "Threads replies", method: "GET", headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    pages += 1;

    let reachedKnown = false;
    for (const reply of data.data ?? []) {
      const at = toIso(reply.timestamp);
      if (!reply.id || !at) continue;
      newestAt = laterOf(newestAt, at);
      if (!isNewer(at, since)) {
        reachedKnown = true;
        continue;
      }
      if (reply.username === auth.selfUsername) continue;
      items.push(
        newItem(
          post,
          {
            externalId: reply.id,
            kind: "reply",
            authorName: handle(reply.username),
            text: reply.text ?? "(media reply)",
            at,
            permalink: reply.permalink
          },
          now
        )
      );
    }

    const next = data.paging?.next ? data.paging.cursors?.after : undefined;
    if (reachedKnown || !next) {
      complete = true;
      break;
    }
    after = next;
  }

  return { items, newestAt, pages, truncated: !complete };
}
