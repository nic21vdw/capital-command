import { aiConfigured, runAi } from "@/lib/ai";
import { CHANNEL_KEYWORDS } from "@/lib/clipping/keywords";
import type { PlatformId } from "@/lib/publisher/types";

/**
 * Per-platform post copy for the Uploading Center. One finished clip reads very
 * differently on YouTube Shorts, TikTok, Instagram Reels and Facebook — search
 * SEO vs trend-native slang vs caption-and-hashtag culture — so this tailors the
 * caption and hashtag set to the target platform instead of posting one generic
 * blurb everywhere. It also suggests a strong local post time per platform.
 *
 * House AI pattern: *Configured() gate, pure prompt builder, tolerant parser,
 * graceful heuristic fallback. Free on DeepSeek Flash, so tailoring every
 * platform costs nothing.
 */

export type PlatformCopy = {
  caption: string;
  hashtags: string[];
  /** Suggested local post time "HH:mm", when the model offered one. */
  bestTime?: string;
  /** One line on why that time / angle fits the platform. */
  note?: string;
};

export type CopySource = {
  title?: string;
  topic?: string;
  spokenText?: string;
};

const MAX_HASHTAGS = 8;
const MAX_CAPTION_CHARS = 500;

/** How each platform's audience and copy conventions differ. */
const PLATFORM_GUIDE: Record<PlatformId, string> = {
  youtube:
    "YouTube Shorts: a searchable, benefit-led caption (viewers find Shorts via search and suggested). Front-load keywords, 1-2 sentences, then hashtags. Favor discoverability over slang.",
  tiktok:
    "TikTok: native, punchy, conversational hook in the first line — write like a creator, not a brand. Short. Mix a couple of broad trend hashtags with niche ones.",
  instagram:
    "Instagram Reels: a caption with personality and a light call-to-engage (save/share). A tasteful line break is fine. Hashtags are expected and should blend broad + niche.",
  facebook:
    "Facebook Reels: slightly longer, plain-spoken and context-giving for an older audience. Fewer hashtags; clarity over slang."
};

const PLATFORM_HASHTAG_TARGET: Record<PlatformId, number> = {
  youtube: 4,
  tiktok: 5,
  instagram: 8,
  facebook: 3
};

export function platformCopyConfigured(): boolean {
  return aiConfigured();
}

export function normalizeHashtags(tags: string[], limit = MAX_HASHTAGS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = `#${String(raw).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`;
    if (tag.length < 2) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}

/** Builds the tailoring prompt. Pure, for tests. */
export function buildPlatformCopyPrompt(
  source: CopySource,
  platform: PlatformId,
  timezone: string
): string {
  const lines: string[] = [
    `You are writing the post copy for a single short-form vertical clip being posted to ${platform.toUpperCase()}.`,
    "",
    PLATFORM_GUIDE[platform],
    "",
    "Channel context: the creator builds CoLateral (an AI workspace for structural engineers) live with AI coding tools and teaches AI, coding and business.",
    `Channel keywords to weave in when they genuinely fit: ${CHANNEL_KEYWORDS.join(", ")}.`,
    ""
  ];
  if (source.title?.trim()) lines.push(`Clip title: ${source.title.trim()}`);
  if (source.topic?.trim()) lines.push(`Topic: ${source.topic.trim()}`);
  if (source.spokenText?.trim()) lines.push(`What is said in the clip:\n${source.spokenText.trim().slice(0, 1800)}`);
  lines.push(
    "",
    `Return ONLY a JSON object: {"caption": string, "hashtags": string[], "bestTime": "HH:mm", "note": string}`,
    `- "caption": tailored for ${platform}, under ${MAX_CAPTION_CHARS} characters, no clickbait lies, no emoji spam.`,
    `- "hashtags": about ${PLATFORM_HASHTAG_TARGET[platform]} hashtags with the # prefix, ordered strongest first.`,
    `- "bestTime": a strong local time to post on ${platform} in 24h "HH:mm" (timezone ${timezone}).`,
    `- "note": one short sentence on the angle or timing choice.`
  );
  return lines.join("\n");
}

/** Pulls the copy object out of the reply, tolerating fences / prose. Pure. */
export function parsePlatformCopy(text: string): PlatformCopy | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const caption = typeof parsed.caption === "string" ? parsed.caption.trim().slice(0, MAX_CAPTION_CHARS) : "";
    if (!caption) return null;
    const hashtags = Array.isArray(parsed.hashtags)
      ? normalizeHashtags(parsed.hashtags.filter((tag): tag is string => typeof tag === "string"))
      : [];
    const bestTime =
      typeof parsed.bestTime === "string" && /^\d{1,2}:\d{2}$/.test(parsed.bestTime.trim())
        ? parsed.bestTime.trim().padStart(5, "0")
        : undefined;
    const note = typeof parsed.note === "string" ? parsed.note.trim() : undefined;
    return { caption, hashtags, bestTime, note };
  } catch {
    return null;
  }
}

/** Offline fallback: a usable caption built from what the clip already knows. */
export function fallbackPlatformCopy(source: CopySource, platform: PlatformId): PlatformCopy {
  const base = source.title?.trim() || source.topic?.trim() || "New clip";
  const hashtags = normalizeHashtags(
    ["AI", "vibecoding", "coding", "buildinpublic", "startup"],
    PLATFORM_HASHTAG_TARGET[platform]
  );
  return { caption: base.slice(0, MAX_CAPTION_CHARS), hashtags };
}

/**
 * Tailors caption + hashtags (and a best-time hint) for one platform. Never
 * throws — returns the heuristic fallback on any failure.
 */
export async function generatePlatformCopy(
  source: CopySource,
  platform: PlatformId,
  timezone = "America/Toronto"
): Promise<PlatformCopy> {
  const fallback = fallbackPlatformCopy(source, platform);
  if (!platformCopyConfigured()) return fallback;
  try {
    const result = await runAi({
      maxTokens: 600,
      system:
        "You are a short-form social copywriter who writes native, platform-aware captions. You never fabricate facts or numbers. You output strict JSON when asked.",
      messages: [{ role: "user", content: buildPlatformCopyPrompt(source, platform, timezone) }]
    });
    if (!result || result.refused) return fallback;
    const parsed = parsePlatformCopy(result.text);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
