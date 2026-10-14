import { carouselIdFromImagePaths } from "@/lib/carousels/booked";
import { ANALYTICS_PLATFORMS, postKey, type AnalyticsPlatform, type PostFormat, type Target } from "@/lib/analytics/types";
import { itemAccountId } from "@/lib/publisher/accounts";
import { publishQueue } from "@/lib/publisher/queue";
import type { QueueItem } from "@/lib/publisher/types";
import { readQueue } from "@/lib/threads/queue";
import type { ThreadsQueueItem } from "@/lib/threads/types";

function formatOf(item: QueueItem): { format: PostFormat; carouselId?: string } {
  if (item.mediaKind === "image") {
    const carouselId = carouselIdFromImagePaths(item.imagePaths);
    return carouselId ? { format: "carousel", carouselId } : { format: "image" };
  }
  return { format: item.format === "long" ? "long-form" : "video" };
}

export function collectTargets(input: { publishItems: QueueItem[]; threadsItems: ThreadsQueueItem[] }): Target[] {
  const targets = new Map<string, Target>();

  for (const item of input.publishItems) {
    const { format, carouselId } = formatOf(item);
    for (const [name, state] of Object.entries(item.platforms)) {
      const platform = ANALYTICS_PLATFORMS.find((candidate) => candidate === name) as AnalyticsPlatform | undefined;
      if (!platform || platform === "threads" || !state || state.status !== "published" || !state.postId) continue;
      const key = postKey(platform, state.postId);
      if (targets.has(key)) continue;
      const target: Target = {
        platform,
        accountId: itemAccountId(item, platform),
        postId: state.postId,
        itemId: item.id,
        format,
        title: item.title,
        caption: item.caption,
        publishedAt: state.publishedAt ?? item.publishAt,
        visibility: item.visibility
      };
      if (carouselId) target.carouselId = carouselId;
      targets.set(key, target);
    }
  }

  for (const item of input.threadsItems) {
    if (item.status !== "published" || !item.postId) continue;
    const key = postKey("threads", item.postId);
    if (targets.has(key)) continue;
    targets.set(key, {
      platform: "threads",
      accountId: item.accountId,
      postId: item.postId,
      itemId: item.id,
      format: "text",
      title: item.topic,
      caption: item.text,
      publishedAt: item.publishedAt ?? item.publishAt
    });
  }

  return [...targets.values()];
}

export async function loadTargets(): Promise<Target[]> {
  const [publishItems, threadsItems] = await Promise.all([publishQueue().list(), readQueue()]);
  return collectTargets({ publishItems, threadsItems });
}
