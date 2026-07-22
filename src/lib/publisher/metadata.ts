import { runAi } from "@/lib/ai";
import type { QueueItem } from "@/lib/publisher/types";
import { CLIP_DESCRIPTION_TEMPLATE } from "@/lib/clipping/editor";

/**
 * Post metadata (title / description / hashtags) for a finished clip.
 *
 * Mirrors the transcript-select pattern: ask Claude when ANTHROPIC_API_KEY is
 * set, degrade gracefully to a heuristic built from what the clipper already
 * knows (stream title, topic, spoken text) when it is not. Callers can always
 * pass explicit values to skip generation entirely.
 */

export type ClipMetadata = {
  title: string;
  description: string;
  hashtags: string[];
};

const MAX_TITLE_CHARS = 90; // fits YouTube's 100-char limit with room to spare
const MAX_HASHTAGS = 6;

function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = `#${raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`;
    if (tag.length < 2) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out;
}

/** Offline fallback: derive a title from existing clip metadata; every clip
 *  carries the same standing CoLateral description. */
export function fallbackMetadata(source: {
  streamTitle?: string;
  topic?: string;
  spokenText?: string;
}): ClipMetadata {
  const base = source.streamTitle?.trim() || source.topic?.trim() || "New clip";
  const title = base.length > MAX_TITLE_CHARS ? `${base.slice(0, MAX_TITLE_CHARS - 1)}…` : base;
  return {
    title,
    description: CLIP_DESCRIPTION_TEMPLATE,
    hashtags: []
  };
}

/** Pulls the JSON object out of the model's reply, tolerating fences / prose. */
function parseMetadata(text: string): Partial<ClipMetadata> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((t): t is string => typeof t === "string") : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Generates a punchy, complete-sentence title for the clip. The description
 * is always the standing CoLateral boilerplate — never model-generated.
 * Never throws — falls back to the heuristic on any error.
 */
export async function generateClipMetadata(source: {
  streamTitle?: string;
  topic?: string;
  spokenText?: string;
}): Promise<ClipMetadata> {
  const fallback = fallbackMetadata(source);
  try {
    const result = await runAi({
      maxTokens: 400,
      messages: [
        {
          role: "user",
          content: [
            "You write the title for a short-form vertical clip posted to YouTube Shorts, Instagram Reels and TikTok.",
            source.streamTitle ? `Stream title: ${source.streamTitle}` : "",
            source.topic ? `Topic: ${source.topic}` : "",
            source.spokenText ? `What is said in the clip:\n${source.spokenText.slice(0, 2000)}` : "",
            "",
            `Reply with ONLY a JSON object: {"title": string} — a complete thought or sentence, never cut off mid-phrase, max ${MAX_TITLE_CHARS} chars, punchy, no clickbait lies, no emojis.`
          ]
            .filter(Boolean)
            .join("\n")
        }
      ]
    });
    if (!result || result.refused) return fallback;
    const parsed = parseMetadata(result.text);
    if (!parsed?.title) return fallback;
    return {
      title: parsed.title.slice(0, MAX_TITLE_CHARS + 10),
      description: CLIP_DESCRIPTION_TEMPLATE,
      hashtags: []
    };
  } catch {
    return fallback;
  }
}

/** Full caption for platforms that take one text field (IG caption, TikTok title). */
export function composeCaption(item: Pick<QueueItem, "caption" | "hashtags">): string {
  const tags = normalizeHashtags(item.hashtags).join(" ");
  return tags ? `${item.caption.trim()}\n\n${tags}` : item.caption.trim();
}

/** YouTube description: caption plus hashtags on their own line. */
export function composeDescription(item: Pick<QueueItem, "caption" | "hashtags">): string {
  return composeCaption(item);
}

/** Bare tag words (no #) for YouTube's snippet.tags. */
export function bareTags(item: Pick<QueueItem, "hashtags">): string[] {
  return normalizeHashtags(item.hashtags).map((tag) => tag.slice(1));
}
