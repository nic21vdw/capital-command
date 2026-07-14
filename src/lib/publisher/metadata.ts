import Anthropic from "@anthropic-ai/sdk";
import type { QueueItem } from "@/lib/publisher/types";
import {
  generateClipDescriptionFromText,
  generateClipHashtagsFromText
} from "@/lib/clipping/editor";

/**
 * Post metadata (title / description / hashtags) for a finished clip.
 *
 * Claude uses the clip transcript when available. The offline path uses the
 * same transcript-aware description and tag rules as the clip generator, so
 * every ready clip still has useful metadata without an API key.
 */

export type ClipMetadata = {
  title: string;
  description: string;
  hashtags: string[];
};

const MAX_TITLE_CHARS = 90;
const MAX_HASHTAGS = 5;

function normalizeHashtags(tags: string[], fallback: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...tags, ...fallback]) {
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

function fallbackTitle(source: { streamTitle?: string; topic?: string; spokenText?: string }): string {
  const speech = source.spokenText?.replace(/\s+/g, " ").trim() ?? "";
  const sentence = speech
    .split(/(?<=[.!?])\s+/)
    .find((part) => {
      const words = part.trim().split(/\s+/);
      return words.length >= 4 && words.length <= 12 && part.trim().length <= MAX_TITLE_CHARS;
    });
  const base = sentence?.replace(/[.!?]+$/, "").trim() || source.topic?.trim() || source.streamTitle?.trim() || "New clip";
  return base.length > MAX_TITLE_CHARS ? `${base.slice(0, MAX_TITLE_CHARS - 1)}…` : base;
}

export function fallbackMetadata(source: {
  streamTitle?: string;
  topic?: string;
  spokenText?: string;
}): ClipMetadata {
  const text = [source.topic, source.spokenText].filter(Boolean).join(" ");
  return {
    title: fallbackTitle(source),
    description: generateClipDescriptionFromText(source.spokenText ?? source.topic ?? source.streamTitle ?? ""),
    hashtags: generateClipHashtagsFromText(text, MAX_HASHTAGS)
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

function addBrandFooter(description: string): string {
  const summary = description.trim();
  const footer = "Follow along as I build CoLateral in public: https://colateral.ai";
  if (!summary) return footer;
  if (summary.includes("colateral.ai")) return summary;
  return `${summary}\n\n${footer}`;
}

/**
 * Generates a complete title, clip-aware description, and exactly five
 * relevant hashtags. Never throws and never returns an empty metadata field.
 */
export async function generateClipMetadata(source: {
  streamTitle?: string;
  topic?: string;
  spokenText?: string;
}): Promise<ClipMetadata> {
  const fallback = fallbackMetadata(source);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            "Write metadata for a short vertical clip posted to YouTube Shorts, Instagram Reels, and TikTok.",
            source.streamTitle ? `Stream title: ${source.streamTitle}` : "",
            source.topic ? `Topic: ${source.topic}` : "",
            source.spokenText ? `What is said in the clip:\n${source.spokenText.slice(0, 3000)}` : "",
            "",
            `Reply with ONLY JSON: {"title": string, "description": string, "hashtags": string[]}. The title must be a complete thought, punchy but truthful, no emojis, and at most ${MAX_TITLE_CHARS} characters. The description must be 1-2 concise sentences explaining this specific clip, with no hashtags or generic filler. Return exactly ${MAX_HASHTAGS} relevant hashtags without the # prefix. Prefer focused tags such as AI, buildinpublic, business, vibecoding, engineering, automation, productivity, startup, or contentcreation only when the clip supports them.`
          ]
            .filter(Boolean)
            .join("\n")
        }
      ]
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const parsed = parseMetadata(text);
    if (!parsed?.title || !parsed.description) return fallback;
    return {
      title: parsed.title.trim().slice(0, MAX_TITLE_CHARS),
      description: addBrandFooter(parsed.description),
      hashtags: normalizeHashtags(parsed.hashtags ?? [], fallback.hashtags)
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
