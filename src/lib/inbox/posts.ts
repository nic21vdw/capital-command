import type { InboxPlatform, PublishedPost } from "@/lib/inbox/types";
import { isPrimaryAccountId, itemAccountId } from "@/lib/publisher/accounts";
import { publishQueue } from "@/lib/publisher/queue";
import type { PlatformId } from "@/lib/publisher/types";
import { readQueue as readThreadsQueue } from "@/lib/threads/queue";

const QUEUE_PLATFORMS: PlatformId[] = ["youtube", "instagram", "facebook"];
const THREADS_TITLE_LENGTH = 80;

function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > THREADS_TITLE_LENGTH ? `${flat.slice(0, THREADS_TITLE_LENGTH - 1)}…` : flat;
}

export async function listPublishedPosts(): Promise<PublishedPost[]> {
  const posts = new Map<string, PublishedPost>();
  const add = (post: PublishedPost) => {
    const key = `${post.platform}:${post.postId}`;
    if (!posts.has(key)) posts.set(key, post);
  };

  for (const item of await publishQueue().list()) {
    for (const platform of QUEUE_PLATFORMS) {
      const state = item.platforms[platform];
      if (!state || state.status !== "published" || !state.postId) continue;
      const accountId = itemAccountId(item, platform);
      if (platform !== "youtube" && !isPrimaryAccountId(accountId)) continue;
      if (platform === "youtube" && item.visibility === "private") continue;
      add({
        platform: platform as InboxPlatform,
        accountId,
        postId: state.postId,
        title: item.title,
        publishedAt: state.publishedAt ?? item.publishAt,
        ...(platform === "youtube" ? { url: `https://www.youtube.com/watch?v=${state.postId}` } : {})
      });
    }
  }

  for (const item of await readThreadsQueue()) {
    if (item.status !== "published" || !item.postId) continue;
    add({
      platform: "threads",
      accountId: item.accountId,
      postId: item.postId,
      title: titleFrom(item.text),
      publishedAt: item.publishedAt ?? item.publishAt
    });
  }

  return [...posts.values()];
}
