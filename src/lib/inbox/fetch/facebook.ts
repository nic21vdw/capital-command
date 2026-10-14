import { newItem, MAX_PAGES, type FetchOptions, type FetchResult } from "@/lib/inbox/fetch/common";
import { isNewer, laterOf, toIso } from "@/lib/inbox/time";
import type { InboxItem, PublishedPost } from "@/lib/inbox/types";
import { fetchJson } from "@/lib/publisher/http";

export type FacebookAuth = { accessToken: string; graphApiVersion: string; pageId: string };

type FacebookComment = {
  id?: string;
  message?: string;
  created_time?: string;
  from?: { id?: string; name?: string };
  permalink_url?: string;
  parent?: { id?: string };
};
type FacebookResponse = { data?: FacebookComment[]; paging?: { cursors?: { after?: string }; next?: string } };

const FIELDS = "id,message,created_time,from{id,name},permalink_url,parent{id}";

export async function fetchFacebookComments(
  post: PublishedPost,
  since: string | null,
  auth: FacebookAuth,
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
    const query = new URLSearchParams({
      fields: FIELDS,
      filter: "stream",
      order: "reverse_chronological",
      limit: "50",
      access_token: auth.accessToken
    });
    if (after) query.set("after", after);
    const data = await fetchJson<FacebookResponse>(
      `https://graph.facebook.com/${auth.graphApiVersion}/${encodeURIComponent(post.postId)}/comments?${query}`,
      { label: "Facebook comments", method: "GET" }
    );
    pages += 1;

    let reachedKnown = false;
    for (const comment of data.data ?? []) {
      const at = toIso(comment.created_time);
      if (!comment.id || !at) continue;
      newestAt = laterOf(newestAt, at);
      if (!isNewer(at, since)) {
        reachedKnown = true;
        continue;
      }
      if (comment.from?.id === auth.pageId) continue;
      items.push(
        newItem(
          post,
          {
            externalId: comment.id,
            kind: comment.parent?.id ? "reply" : "comment",
            authorName: comment.from?.name ?? "Facebook user",
            text: comment.message ?? "(no text)",
            at,
            parentId: comment.parent?.id,
            permalink: comment.permalink_url
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
