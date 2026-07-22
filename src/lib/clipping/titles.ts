import Anthropic from "@anthropic-ai/sdk";

/**
 * Viral clip titles. Instead of slicing a fragment out of the transcript
 * (which reads as a broken, mid-sentence thought), each clip's transcript is
 * sent to Claude with a style guide — example titles plus the channel's
 * recurring keywords — and Claude writes a complete, scroll-stopping title.
 *
 * This module is the reference for ALL clip/video metadata generation: when
 * descriptions, tags, or hashtags get an AI pass, reuse CHANNEL_KEYWORDS and
 * TITLE_STYLE_EXAMPLES so everything shares one voice.
 *
 * Degrades gracefully: returns null when there is no API key or the call
 * fails, so callers can fall back to the local heuristic titler.
 */

/** Recurring channel topics woven into titles/descriptions/tags when the clip supports them. */
export const CHANNEL_KEYWORDS = [
  "AI",
  "vibe coding",
  "Claude",
  "ChatGPT",
  "AI agents",
  "coding",
  "SaaS",
  "startup",
  "business",
  "building in public",
  "engineering",
  "automation"
];

/** Example titles that define the channel's title voice. */
export const TITLE_STYLE_EXAMPLES = [
  "Vibe Coding a SaaS With Claude in 30 Minutes",
  "This AI Coding Trick Saves Me Hours Every Week",
  "Why I Let AI Write All My Code",
  "ChatGPT vs Claude for Real Business Work",
  "Building a Startup Live With AI Agents",
  "The AI Mistake Every New Founder Makes",
  "I Made AI Build My Entire Landing Page",
  "How Vibe Coding Changed My Engineering Business"
];

export const VIRAL_TITLE_SYSTEM_PROMPT = `You are a short-form video growth expert who writes scroll-stopping titles for YouTube Shorts, TikTok, and Reels.

Channel context: the creator live-streams himself building CoLateral (an AI-powered workspace for structural engineers) using AI coding tools. Recurring keywords to work in whenever the clip's content genuinely supports them: ${CHANNEL_KEYWORDS.join(", ")}.

Every title must:
- Be a complete, grammatical phrase — NEVER a raw transcript fragment and never a thought that trails off mid-sentence.
- Be 4-10 words and under 60 characters, in Title Case.
- Lead with curiosity, stakes, or a bold claim; numbers and How/Why/What openers work well.
- Use the channel keywords naturally when they fit the clip — never force one that doesn't.
- Contain no quotation marks, hashtags, or emoji.

Examples of the exact style to match:
${TITLE_STYLE_EXAMPLES.map((t) => `- ${t}`).join("\n")}

You always return strict JSON.`;

export type ClipTitleRequest = {
  /** Stable clip id the returned title is keyed back to. */
  id: string;
  /** The clip's transcript text (clip-local, plain text). */
  transcript: string;
};

/** Longest transcript excerpt sent per clip — enough to understand the moment. */
const MAX_TRANSCRIPT_CHARS = 700;
const MAX_TITLE_CHARS = 75;

export function viralTitlesConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Builds the user prompt listing every clip's transcript. Pure, for tests. */
export function buildViralTitleUserPrompt(
  clips: ClipTitleRequest[],
  context?: { streamTitle?: string; topic?: string }
): string {
  const lines: string[] = [];
  if (context?.streamTitle?.trim()) lines.push(`Stream: ${context.streamTitle.trim()}`);
  if (context?.topic?.trim()) lines.push(`The creator asked for clips focused on: ${context.topic.trim()}`);
  lines.push(
    `Write one viral title for EACH of the ${clips.length} clip transcripts below.`,
    "",
    'Return ONLY a JSON array (no prose) of objects: [{"id": "<clip id>", "title": "<title>"}] — one entry per clip, keeping each clip\'s id exactly as given.',
    ""
  );
  for (const clip of clips) {
    const excerpt = clip.transcript.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_CHARS);
    lines.push(`Clip ${clip.id}:`, excerpt, "");
  }
  return lines.join("\n");
}

/**
 * Normalizes a model-written title: strips wrapping quotes, hashtags, emoji
 * and extra whitespace. Returns "" when what's left is too thin or too long
 * to be a real title, so the caller falls back instead of using junk.
 */
export function cleanViralTitle(raw: string): string {
  const cleaned = raw
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/#[\w-]+/g, " ")
    // Strip emoji and pictographs; keep letters, digits and basic punctuation.
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.split(/\s+/).length < 3) return "";
  if (cleaned.length > MAX_TITLE_CHARS) return "";
  return cleaned;
}

/** Pulls the id->title map out of the model's reply, tolerating fences/prose. */
export function parseViralTitles(text: string): Map<string, string> {
  const titles = new Map<string, string>();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return titles;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(parsed)) return titles;
    for (const entry of parsed) {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      const title = typeof entry?.title === "string" ? cleanViralTitle(entry.title) : "";
      if (id && title) titles.set(id, title);
    }
  } catch {
    // Unparseable reply — callers fall back to the heuristic titler.
  }
  return titles;
}

/**
 * Writes a viral title for each clip in one Claude call. Returns a map of
 * clip id -> title (possibly missing some ids), or null when title generation
 * is unavailable or failed entirely.
 */
export async function generateViralTitles(
  clips: ClipTitleRequest[],
  context?: { streamTitle?: string; topic?: string }
): Promise<Map<string, string> | null> {
  if (!viralTitlesConfigured()) return null;
  const withText = clips.filter((clip) => clip.transcript.trim());
  if (withText.length === 0) return null;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      system: VIRAL_TITLE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildViralTitleUserPrompt(withText, context) }]
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("\n");
    const titles = parseViralTitles(text);
    return titles.size > 0 ? titles : null;
  } catch {
    return null;
  }
}
