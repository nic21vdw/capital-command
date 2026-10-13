import type { QueueItem } from "@/lib/publisher/types";
import type { HeldPost } from "@/lib/automations/types";
import { truncateAtWord } from "@/lib/automations/format";
import { platformCheckUrl, uploadingCenterHref } from "@/lib/automations/links";
import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
import { pastSlotMarker, shouldBeLiveHint, slotOverdue } from "@/lib/publisher/nativeScheduling";

const FACEBOOK_SCHEDULED = platformCheckUrl("Facebook")!;
const BUFFER_QUEUE = "https://publish.buffer.com";

export const HELD_LIMIT = 25;

/**
 * Posts that YouTube, Facebook or Buffer already hold and will publish by
 * themselves. Pausing the publisher cannot stop these, so Automations lists
 * them with a way to cancel on the platform. Soonest first.
 *
 * A held post whose slot has passed (the same `pastSlotMarker` rule the
 * Uploading Center's "Should be live" chip uses) is flagged `shouldBeLive`:
 * "goes live <a time that is gone>" is not true of it any more. A YouTube
 * upload held private for review is never flagged; it does not go live by itself.
 */
export function heldPosts(queue: QueueItem[], now: Date = new Date()): HeldPost[] {
  const rows: HeldPost[] = [];
  const late = (platform: "youtube" | "facebook", item: QueueItem, label: "YouTube" | "Facebook") => {
    const leg = item.platforms[platform];
    const marker = leg ? pastSlotMarker(platform, leg, item, now) : null;
    // The marker needs a recorded post id; an upload the platform holds without
    // one is just as past its time, and "goes live" is just as untrue of it.
    const pastWithoutMarker =
      !marker && slotOverdue(item.publishAt, now) && !(platform === "youtube" && youtubeHoldsForReview(item));
    return marker?.kind === "should-be-live" || pastWithoutMarker
      ? { shouldBeLive: { hint: shouldBeLiveHint(platform), linkLabel: `Check ${label}`, platform: label } }
      : {};
  };
  for (const item of queue) {
    const title = truncateAtWord(item.title || item.caption || "Untitled post", 90);
    const base = { id: item.id, title, href: uploadingCenterHref(item) };
    const youtube = item.platforms.youtube;
    if (youtube && (youtube.status === "uploaded" || youtube.status === "scheduled")) {
      rows.push({
        ...base, id: `${item.id}:youtube`, platform: "YouTube", status: youtube.status, goesLiveAt: item.publishAt, ...late("youtube", item, "YouTube"),
        ...(youtube.postId ? { externalUrl: `https://studio.youtube.com/video/${encodeURIComponent(youtube.postId)}/edit`, externalLabel: "Open in YouTube Studio" } : { externalUrl: "https://studio.youtube.com", externalLabel: "Open YouTube Studio" })
      });
    }
    const facebook = item.platforms.facebook;
    if (facebook && (facebook.status === "uploaded" || facebook.status === "scheduled")) {
      rows.push({ ...base, id: `${item.id}:facebook`, platform: "Facebook", status: facebook.status, goesLiveAt: item.publishAt, ...late("facebook", item, "Facebook"), externalUrl: FACEBOOK_SCHEDULED, externalLabel: "Open Facebook scheduled posts" });
    }
    if (item.buffer?.status === "scheduled") {
      rows.push({ ...base, id: `${item.id}:buffer`, platform: "Buffer", status: "scheduled", goesLiveAt: item.publishAt,
        ...(slotOverdue(item.publishAt, now) ? { shouldBeLive: { hint: "Its slot passed - Buffer should have published it by now.", linkLabel: "Check Buffer", platform: "Buffer" as const } } : {}),
        externalUrl: BUFFER_QUEUE, externalLabel: "Open Buffer" });
    }
  }
  return rows.sort((a, b) => Date.parse(a.goesLiveAt) - Date.parse(b.goesLiveAt) || a.id.localeCompare(b.id));
}
