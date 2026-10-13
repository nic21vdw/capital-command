import { generateClipMetadata } from "@/lib/publisher/metadata";
import { normalizeHashtags } from "@/lib/clipping/hashtags";

const TITLE_HASHTAG = /#[\p{L}\p{N}_]+/gu;

/**
 * The title, title-tags and caption a post is booked with, whatever the
 * request left out. This is the one door every route into the queue shares, so
 * the rules live here once:
 *
 *  - A BLANK IS MISSING. `""` and whitespace used to count as "given": the
 *    `??=` that filled gaps skipped them, so a card scheduled with an empty
 *    caption box posted an empty caption (and, with no hashtags sent,
 *    nothing but the generic `#shorts`).
 *  - A CAPTION IS NEVER EMPTY. Generated copy first, which is the standing
 *    description; where the owner has not written one, the clip's own title
 *    (without its hashtags, which travel separately), the same words the
 *    Uploading Center's bulk booking falls back to.
 *  - THE CLIP'S OWN HASHTAGS COME FIRST. Hashtags typed or chipped into the
 *    title are the person's choice, so they lead the generated set instead of
 *    being replaced by it. Hashtags that were sent are used exactly as sent.
 *
 * Generation only runs when something is missing, and never throws.
 */
export async function completePostMetadata(
  given: { title?: string; caption?: string; hashtags?: string[] },
  source: { streamTitle?: string; topic?: string; spokenText?: string }
): Promise<{ title: string; caption: string; hashtags: string[] }> {
  let title = given.title?.trim() || "";
  let caption = given.caption?.trim() || "";
  let hashtags = given.hashtags?.filter((tag) => tag.trim()) ?? [];
  if (!title || !caption || hashtags.length === 0) {
    const generated = await generateClipMetadata(source);
    title ||= generated.title;
    caption ||= generated.description.trim();
    if (hashtags.length === 0) {
      hashtags = normalizeHashtags([...(title.match(TITLE_HASHTAG) ?? []), ...generated.hashtags]);
    }
  }
  if (!caption) caption = title.replace(TITLE_HASHTAG, "").replace(/\s{2,}/g, " ").trim() || title;
  return { title, caption, hashtags };
}
