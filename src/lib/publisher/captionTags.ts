/**
 * Pulls a trailing hashtag line off a caption so it can travel as the queue
 * item's `hashtags` instead.
 *
 * The AI caption in the Uploading Center is shown with its hashtags on a last
 * line (so the person sees and edits one box), but a queued post stores caption
 * and hashtags separately and `composeCaption` appends the hashtags at publish
 * time. A request that sent the hashtags inside the caption and none in the
 * `hashtags` field made `enqueue` generate a second set, so Instagram, TikTok and
 * Facebook posted two hashtag blocks.
 *
 * Only a LAST LINE made of nothing but hashtags is taken. A hashtag inside a
 * sentence ("I love #coding") is part of the sentence and stays where it is.
 */
const HASHTAG = /^#[\p{L}\p{N}_]+$/u;

export function splitTrailingHashtags(caption: string): { caption: string; hashtags: string[] } {
  const lines = caption.trimEnd().split(/\r?\n/);
  const last = lines[lines.length - 1]?.trim() ?? "";
  const tokens = last.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((token) => HASHTAG.test(token))) {
    return { caption: caption.trim(), hashtags: [] };
  }
  return { caption: lines.slice(0, -1).join("\n").trim(), hashtags: tokens };
}

/** The `caption` and `hashtags` fields of a schedule request for a draft's caption. */
export function captionRequestFields(draftCaption: string): { caption?: string; hashtags?: string[] } {
  const { caption, hashtags } = splitTrailingHashtags(draftCaption);
  return {
    caption: caption || undefined,
    ...(hashtags.length > 0 ? { hashtags } : {})
  };
}
