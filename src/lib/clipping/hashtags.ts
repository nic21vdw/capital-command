import { aiConfigured, runAi } from "@/lib/ai";
import { brandHashtagPolicy, brandKeywords, brandPromptBlock } from "@/lib/brand/kit";

/**
 * Per-clip hashtags for short-form posts.
 *
 * Everything the app books automatically — the Stream Pipeline's booking
 * sheet, the clip job, the channel ingest scan — reached the queue through
 * `generateClipMetadata`, which returned `hashtags: []`. So every
 * automatically scheduled short posted with no hashtags at all and no
 * YouTube `snippet.tags`, while the hand-driven Uploading Center button
 * (`publisher/ai-copy.ts`) wrote them per platform. Shorts are surfaced by
 * topic as much as by watch time, and an untagged one starts cold.
 *
 * This is the metadata convention from `titles.ts` applied to tags, as
 * CLAUDE.md says it should be: the channel's own vocabulary, written by the
 * model when a key is configured, and a keyword match over the clip's own
 * words when it is not. Never throws — an empty list is always a safe answer.
 */

export function baseHashtags(): string[] {
  return brandHashtagPolicy("youtube").base;
}

export function maxHashtags(): number {
  return brandHashtagPolicy("youtube").max;
}

const MAX_TRANSCRIPT_CHARS = 900;

export function hashtagSystemPrompt(): string {
  return `You write the hashtags for a short-form vertical video posted to YouTube Shorts, Instagram Reels, TikTok and Facebook Reels.

${brandPromptBlock("youtube")}

Rules:
- Choose tags a real viewer of THIS clip would search or follow — specific to what is actually said, not a generic pile.
- Mix one or two broad, high-traffic tags with more specific niche ones.
- Single words or tight compounds, no spaces, no punctuation, no emoji.
- Never invent a claim the clip does not support.

You always return strict JSON.`;
}

/** Normalizes one raw tag to `#tag`, or "" when nothing usable is left. */
export function normalizeHashtag(raw: string): string {
  const body = raw
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .trim();
  if (body.length < 2) return "";
  return `#${body}`;
}

/** Dedupes (case-insensitively), drops junk and caps the list. */
export function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const cap = maxHashtags();
  for (const raw of tags) {
    const tag = normalizeHashtag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Offline tags: the channel keywords the clip's own words actually mention,
 * behind the standing format tag. Deliberately conservative — a keyword that
 * was not said does not become a tag.
 */
export function fallbackHashtags(source: { spokenText?: string; streamTitle?: string; topic?: string }): string[] {
  const haystack = [source.spokenText, source.streamTitle, source.topic].filter(Boolean).join(" ");
  // Whole words only. "AI" as a substring matches "said", "again" and "email",
  // which would tag every clip ever made with the channel's biggest keyword.
  const matched = brandKeywords().filter((keyword) =>
    new RegExp(`(^|\\P{L})${keyword}($|\\P{L})`, "iu").test(haystack)
  );
  return normalizeHashtags([...baseHashtags(), ...matched]);
}

/** Pulls the tag list out of the model's reply, tolerating fences / prose. */
export function parseHashtags(text: string): string[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    if (!Array.isArray(parsed.hashtags)) return [];
    return parsed.hashtags.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

/** Builds the user prompt. Pure, for tests. */
export function buildHashtagPrompt(source: {
  spokenText?: string;
  streamTitle?: string;
  topic?: string;
  title?: string;
}): string {
  return [
    source.streamTitle?.trim() ? `Stream: ${source.streamTitle.trim()}` : "",
    source.topic?.trim() ? `Topic: ${source.topic.trim()}` : "",
    source.title?.trim() ? `Clip title: ${source.title.trim()}` : "",
    source.spokenText?.trim()
      ? `What is said in the clip:\n${source.spokenText.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_CHARS)}`
      : "",
    "",
    `Return ONLY a JSON object: {"hashtags": string[]} — ${maxHashtags() - 1} to ${maxHashtags()} tags, each with the # prefix, strongest first.`
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Hashtags for one clip. Asks the model when one is configured and falls back
 * to the keyword match otherwise; the format tag always leads. Never throws.
 */
export async function generateClipHashtags(source: {
  spokenText?: string;
  streamTitle?: string;
  topic?: string;
  title?: string;
}): Promise<string[]> {
  const fallback = fallbackHashtags(source);
  if (!aiConfigured()) return fallback;
  try {
    const result = await runAi({
      maxTokens: 300,
      system: hashtagSystemPrompt(),
      messages: [{ role: "user", content: buildHashtagPrompt(source) }]
    });
    if (!result || result.refused) return fallback;
    const tags = normalizeHashtags([...baseHashtags(), ...parseHashtags(result.text)]);
    return tags.length > baseHashtags().length ? tags : fallback;
  } catch {
    return fallback;
  }
}
