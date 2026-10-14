import { newItem, MAX_PAGES, type FetchOptions, type FetchResult } from "@/lib/inbox/fetch/common";
import { isNewer, laterOf, toIso } from "@/lib/inbox/time";
import type { InboxItem, PublishedPost } from "@/lib/inbox/types";
import { fetchJson } from "@/lib/publisher/http";

const COMMENT_THREADS_URL = "https://www.googleapis.com/youtube/v3/commentThreads";

export type YoutubeAuth = { accessToken: string };

type YoutubeComment = {
  id?: string;
  snippet?: {
    authorDisplayName?: string;
    authorChannelId?: { value?: string };
    textDisplay?: string;
    textOriginal?: string;
    publishedAt?: string;
    parentId?: string;
  };
};

type YoutubeThread = {
  id?: string;
  snippet?: { channelId?: string; topLevelComment?: YoutubeComment };
  replies?: { comments?: YoutubeComment[] };
};

type YoutubeResponse = { items?: YoutubeThread[]; nextPageToken?: string };

function commentLink(videoId: string, commentId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;
}

export async function fetchYoutubeComments(
  post: PublishedPost,
  since: string | null,
  auth: YoutubeAuth,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const now = options.now ?? new Date();
  const maxPages = options.maxPages ?? MAX_PAGES;
  const items: InboxItem[] = [];
  let newestAt: string | null = null;
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const query = new URLSearchParams({
      part: "snippet,replies",
      videoId: post.postId,
      order: "time",
      maxResults: "100",
      textFormat: "plainText"
    });
    if (pageToken) query.set("pageToken", pageToken);
    const data = await fetchJson<YoutubeResponse>(`${COMMENT_THREADS_URL}?${query}`, {
      label: "YouTube commentThreads",
      method: "GET",
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
    pages += 1;

    let reachedKnown = false;
    for (const thread of data.items ?? []) {
      const channelId = thread.snippet?.channelId;
      const isOwn = (comment: YoutubeComment | undefined) =>
        Boolean(channelId) && comment?.snippet?.authorChannelId?.value === channelId;
      const top = thread.snippet?.topLevelComment;
      const topAt = toIso(top?.snippet?.publishedAt);
      if (top?.id && topAt) {
        newestAt = laterOf(newestAt, topAt);
        if (!isNewer(topAt, since)) reachedKnown = true;
        else if (!isOwn(top)) {
          items.push(
            newItem(
              post,
              {
                externalId: top.id,
                kind: "comment",
                authorName: top.snippet?.authorDisplayName ?? "Someone",
                text: top.snippet?.textDisplay ?? top.snippet?.textOriginal ?? "",
                at: topAt,
                permalink: commentLink(post.postId, top.id)
              },
              now
            )
          );
        }
      }
      for (const reply of thread.replies?.comments ?? []) {
        const replyAt = toIso(reply.snippet?.publishedAt);
        if (!reply.id || !replyAt) continue;
        newestAt = laterOf(newestAt, replyAt);
        if (!isNewer(replyAt, since) || isOwn(reply)) continue;
        items.push(
          newItem(
            post,
            {
              externalId: reply.id,
              kind: "reply",
              authorName: reply.snippet?.authorDisplayName ?? "Someone",
              text: reply.snippet?.textDisplay ?? reply.snippet?.textOriginal ?? "",
              at: replyAt,
              parentId: reply.snippet?.parentId ?? top?.id,
              permalink: commentLink(post.postId, reply.id)
            },
            now
          )
        );
      }
    }
    if (reachedKnown || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return { items, newestAt, pages };
}
