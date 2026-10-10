import type { QueueItem } from "@/lib/publisher/types";
import type { HeldPost } from "@/lib/automations/types";
import { uploadingCenterHref } from "@/lib/automations/links";

const FACEBOOK_SCHEDULED = "https://business.facebook.com/latest/posts/scheduled_posts";
const BUFFER_QUEUE = "https://publish.buffer.com";

export const HELD_LIMIT = 25;

/**
 * Posts that YouTube, Facebook or Buffer already hold and will publish by
 * themselves. Pausing the publisher cannot stop these, so Automations lists
 * them with a way to cancel on the platform. Soonest first.
 */
export function heldPosts(queue: QueueItem[]): HeldPost[] {
  const rows: HeldPost[] = [];
  for (const item of queue) {
    const title = (item.title || item.caption || "Untitled post").slice(0, 90);
    const base = { id: item.id, title, href: uploadingCenterHref(item) };
    const youtube = item.platforms.youtube;
    if (youtube && (youtube.status === "uploaded" || youtube.status === "scheduled")) {
      rows.push({
        ...base, id: `${item.id}:youtube`, platform: "YouTube", status: youtube.status, goesLiveAt: item.publishAt,
        ...(youtube.postId ? { externalUrl: `https://studio.youtube.com/video/${encodeURIComponent(youtube.postId)}/edit`, externalLabel: "Open in YouTube Studio" } : { externalUrl: "https://studio.youtube.com", externalLabel: "Open YouTube Studio" })
      });
    }
    const facebook = item.platforms.facebook;
    if (facebook && (facebook.status === "uploaded" || facebook.status === "scheduled")) {
      rows.push({ ...base, id: `${item.id}:facebook`, platform: "Facebook", status: facebook.status, goesLiveAt: item.publishAt, externalUrl: FACEBOOK_SCHEDULED, externalLabel: "Open Facebook scheduled posts" });
    }
    if (item.buffer?.status === "scheduled") {
      rows.push({ ...base, id: `${item.id}:buffer`, platform: "Buffer", status: "scheduled", goesLiveAt: item.publishAt, externalUrl: BUFFER_QUEUE, externalLabel: "Open Buffer" });
    }
  }
  return rows.sort((a, b) => Date.parse(a.goesLiveAt) - Date.parse(b.goesLiveAt) || a.id.localeCompare(b.id));
}
