import { aiConfigured, runAi } from "@/lib/ai";
import { CHANNEL_KEYWORDS, TITLE_STYLE_EXAMPLES } from "@/lib/clipping/keywords";
import { judgeTitle, MAX_TITLE_CHARS, TITLE_QUALITY_RULES } from "@/lib/clipping/title-quality";

// Re-exported so existing importers of these constants keep working; the
// canonical definition lives in the dependency-free keywords.ts so client
// components can pull the vocabulary without dragging in the AI provider.
export { CHANNEL_KEYWORDS, TITLE_STYLE_EXAMPLES };

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

export const VIRAL_TITLE_SYSTEM_PROMPT = `You are a short-form video growth expert who writes scroll-stopping titles for YouTube Shorts, TikTok, and Reels.

Channel context: the creator live-streams himself building CoLateral (an AI-powered workspace for structural engineers) using AI coding tools. Recurring keywords to work in whenever the clip's content genuinely supports them: ${CHANNEL_KEYWORDS.join(", ")}.

Every title must:
- Be a complete, grammatical phrase — NEVER a raw transcript fragment and never a thought that trails off mid-sentence.
- Be 4-10 words and under 60 characters, in Title Case.
- Lead with curiosity, stakes, or a bold claim; numbers and How/Why/What openers work well.
- Use the channel keywords naturally when they fit the clip — never force one that doesn't.
- Contain no quotation marks, hashtags, or emoji.

These are checked automatically and a title that breaks one is thrown away:
${TITLE_QUALITY_RULES.map((rule) => `- ${rule}`).join("\n")}

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

/** How many times a batch is re-asked for the clips whose titles were rejected. */
const MAX_TITLE_ATTEMPTS = 3;

export function viralTitlesConfigured() {
  return aiConfigured();
}

/** A title the quality gate threw out, fed back so the retry doesn't repeat it. */
export type RejectedTitle = { id: string; title: string; reason: string };

/** Builds the user prompt listing every clip's transcript. Pure, for tests. */
export function buildViralTitleUserPrompt(
  clips: ClipTitleRequest[],
  context?: { streamTitle?: string; topic?: string },
  rejected?: RejectedTitle[]
): string {
  const lines: string[] = [];
  if (context?.streamTitle?.trim()) lines.push(`Stream: ${context.streamTitle.trim()}`);
  if (context?.topic?.trim()) lines.push(`The creator asked for clips focused on: ${context.topic.trim()}`);
  if (rejected?.length) {
    lines.push(
      "Your previous titles for these clips were rejected. Write different ones that fix the problem:",
      ...rejected.map((entry) => `- Clip ${entry.id}: "${entry.title}" — ${entry.reason}`),
      ""
    );
  }
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
 * Writes a viral title for each clip. Returns a map of clip id -> title
 * (possibly missing some ids), or null when title generation is unavailable or
 * produced nothing usable.
 *
 * Every title the model returns is put through the quality gate, and the clips
 * whose titles failed are asked again — with the rejected title and the reason
 * attached — up to MAX_TITLE_ATTEMPTS times. Falling through to the heuristic
 * titler on a bad AI title is what let transcript sludge reach the queue: the
 * heuristic's material is the same transcript, so a second look at it was never
 * going to be better than asking again.
 */
export async function generateViralTitles(
  clips: ClipTitleRequest[],
  context?: { streamTitle?: string; topic?: string }
): Promise<Map<string, string> | null> {
  if (!viralTitlesConfigured()) return null;
  const withText = clips.filter((clip) => clip.transcript.trim());
  if (withText.length === 0) return null;

  const accepted = new Map<string, string>();
  let pending = withText;
  let rejected: RejectedTitle[] = [];

  for (let attempt = 0; attempt < MAX_TITLE_ATTEMPTS && pending.length > 0; attempt += 1) {
    let text: string;
    try {
      const result = await runAi({
        maxTokens: 1500,
        system: VIRAL_TITLE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildViralTitleUserPrompt(pending, context, rejected) }]
      });
      if (!result || result.refused) break;
      text = result.text;
    } catch {
      break;
    }

    const titles = parseViralTitles(text);
    if (titles.size === 0) break;

    rejected = [];
    for (const [id, title] of titles) {
      const judgement = judgeTitle(title);
      if (judgement.publishable) accepted.set(id, title);
      else rejected.push({ id, title, reason: judgement.reason ?? "not publishable" });
    }
    pending = pending.filter((clip) => !accepted.has(clip.id));
  }

  return accepted.size > 0 ? accepted : null;
}
