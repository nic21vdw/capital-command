import { type AwaitingEntry, type ReviewPolicy, REVIEW_CHANNELS, threadsAwaitingApproval } from "@/lib/publisher/approval";
import { publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { readQueue } from "@/lib/threads/queue";

export async function listAwaiting(policy: ReviewPolicy): Promise<AwaitingEntry[]> {
  const entries: AwaitingEntry[] = [];
  const publisherHolds = REVIEW_CHANNELS.some((channel) => channel !== "threads" && policy[channel] === "hold");
  if (publisherHolds) {
    for (const { item, platform } of await publishQueue(publisherConfig()).awaitingApproval(policy)) {
      entries.push({
        key: `${platform}:${item.id}`,
        channel: platform,
        id: item.id,
        title: item.title,
        caption: item.caption,
        publishAt: item.publishAt,
        ...(item.accountId ? { accountId: item.accountId } : {})
      });
    }
  }
  if (policy.threads === "hold") {
    for (const item of await readQueue()) {
      if (!threadsAwaitingApproval(item, policy)) continue;
      entries.push({
        key: `threads:${item.id}`,
        channel: "threads",
        id: item.id,
        title: item.topic,
        caption: item.text,
        publishAt: item.publishAt,
        accountId: item.accountId
      });
    }
  }
  return entries.sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.key.localeCompare(b.key));
}
