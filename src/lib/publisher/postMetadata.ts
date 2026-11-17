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
 *  - A CAPTION IS NEVER EMPTY, AND IT OPENS ON THIS POST. A generated caption
 *    is the clip's own title (without its hashtags, which travel separately)
 *    and then the standing description. The caption is the visible text of a
 *    Reel, a Facebook video and a TikTok, and every one of them used to open on
 *    the same boilerplate (652 queue items shared 11 captions). Where the owner
 *    has not written a description, the title alone, the same words the
 *    Uploading Center's bulk booking falls back to. No new model copy: the
 *    title is the one the post is booked under.
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
    if (!caption) caption = [plainTitle(title), generated.description.trim()].filter(Boolean).join("\n\n");
    if (hashtags.length === 0) {
      hashtags = normalizeHashtags([...(title.match(TITLE_HASHTAG) ?? []), ...generated.hashtags]);
    }
  }
  if (!caption) caption = plainTitle(title) || title;
  return { title, caption, hashtags };
}

function plainTitle(title: string): string {
  return title.replace(TITLE_HASHTAG, "").replace(/\s{2,}/g, " ").trim();
}
