import { aiConfigured, runAi } from "@/lib/ai";
import { CHANNEL_KEYWORDS, TITLE_STYLE_EXAMPLES } from "@/lib/clipping/keywords";
import type { PipelinePost } from "@/lib/pipeline/types";

/**
 * Text-only posts for a pipeline run. Follows the clip-title convention
 * (`src/lib/clipping/titles.ts`): the copy is WRITTEN by Claude from the
 * stream's transcript and clip highlights — never sliced out of the
 * transcript — and reuses the channel's keyword set so every output shares
 * one voice. Degrades gracefully: without an API key (or on failure) the
 * fallback builds simple announcement posts from the already-written clip
 * titles, which are complete phrases, not fragments.
 */

export type PipelinePostsInput = {
  streamTitle: string;
  /** Plain transcript text, possibly empty or only the opening minutes. */
  transcriptText: string;
  /** Claude/heuristic-titled best moments from the clip job. */
  clipHighlights: Array<{ title: string; quote?: string }>;
};

const X_POST_COUNT = 3;
const THREADS_POST_COUNT = 2;
const FACEBOOK_POST_COUNT = 1;
const MAX_TRANSCRIPT_CHARS = 4000;
const MAX_POST_CHARS = 600;

export function pipelinePostsConfigured() {
  return aiConfigured();
}

export const PIPELINE_POSTS_SYSTEM_PROMPT = `You write social posts for a creator who live-streams himself building CoLateral (an AI-powered workspace for structural engineers) using AI coding tools. Recurring channel keywords to work in when the content genuinely supports them: ${CHANNEL_KEYWORDS.join(", ")}.

Voice rules for every post:
- Complete, grammatical sentences — NEVER a raw transcript fragment and never a thought that trails off.
- Specific to what actually happened on the stream; no invented facts, numbers, or results.
- No hashtags, no emoji, no generic openers ("Just wrapped up...", "Excited to share...").
- Curiosity, stakes, or a concrete lesson up front — the same energy as these titles:
${TITLE_STYLE_EXAMPLES.map((t) => `  - ${t}`).join("\n")}

You always return strict JSON.`;

/** Builds the user prompt from the run's material. Pure, for tests. */
export function buildPipelinePostsPrompt(input: PipelinePostsInput): string {
  const lines: string[] = [`Stream: ${input.streamTitle.trim() || "(untitled)"}`];
  if (input.clipHighlights.length > 0) {
    lines.push("", "Best moments already clipped from this stream:");
    for (const highlight of input.clipHighlights.slice(0, 10)) {
      const quote = highlight.quote?.trim();
      lines.push(`- ${highlight.title}${quote ? ` (opens with: "${quote}")` : ""}`);
    }
  }
  const transcript = input.transcriptText.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_CHARS);
  if (transcript) {
    lines.push("", "Transcript excerpt (the stream's opening):", transcript);
  }
  lines.push(
    "",
    `Write text-only posts about this stream:`,
    `1. Exactly ${X_POST_COUNT} posts for X — each under 270 characters, each taking a DIFFERENT angle (insight, contrarian take, concrete lesson).`,
    `2. Exactly ${THREADS_POST_COUNT} posts for Threads — the same ideas rephrased warmer and more conversational, different wording so the feeds are not duplicates.`,
    `3. Exactly ${FACEBOOK_POST_COUNT} post for Facebook/LinkedIn — 2-4 sentences telling the story of what was built and inviting people to watch.`,
    "",
    'Return ONLY a JSON array (no prose): [{"platform": "x" | "threads" | "facebook", "text": "..."}].'
  );
  return lines.join("\n");
}

/** Pulls the post list out of the model's reply, tolerating fences/prose. */
export function parsePipelinePosts(text: string): PipelinePost[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const posts: PipelinePost[] = [];
    for (const entry of parsed) {
      const platform = typeof entry?.platform === "string" ? entry.platform.trim().toLowerCase() : "";
      const post = typeof entry?.text === "string" ? entry.text.trim() : "";
      if (!post || post.length > MAX_POST_CHARS) continue;
      if (platform !== "x" && platform !== "threads" && platform !== "facebook") continue;
      posts.push({ id: `post-${posts.length + 1}`, platform, text: post });
    }
    return posts;
  } catch {
    return [];
  }
}

/**
 * Offline fallback: announcement posts built around the clip titles (already
 * complete phrases) and the stream name — simple, but never broken fragments.
 */
export function fallbackPipelinePosts(input: PipelinePostsInput): PipelinePost[] {
  const highlights = input.clipHighlights.filter((h) => h.title.trim());
  const streamTitle = input.streamTitle.trim() || "today's stream";
  const posts: PipelinePost[] = [];
  for (const highlight of highlights.slice(0, X_POST_COUNT)) {
    posts.push({
      id: `post-${posts.length + 1}`,
      platform: "x",
      text: `${highlight.title.trim()} — new clip from ${streamTitle} is live on the channel.`
    });
  }
  if (posts.length === 0) {
    posts.push({
      id: "post-1",
      platform: "x",
      text: `New stream is up: ${streamTitle}. Full build session on the channel.`
    });
  }
  posts.push({
    id: `post-${posts.length + 1}`,
    platform: "facebook",
    text:
      `New session: ${streamTitle}. The full recording, the short clips, and the podcast version are all up now. ` +
      (highlights[0] ? `Start with the best moment: ${highlights[0].title.trim()}.` : `Come watch the build.`)
  });
  return posts;
}

/**
 * Writes the run's text posts in one Claude call. Never throws — returns the
 * fallback pack with a reason when AI is unavailable or the reply is unusable.
 */
export async function generatePipelinePosts(
  input: PipelinePostsInput
): Promise<{ posts: PipelinePost[]; reason: string | null }> {
  if (!pipelinePostsConfigured()) {
    return {
      posts: fallbackPipelinePosts(input),
      reason: "AI is not configured — built simple announcement posts from the clip titles instead."
    };
  }
  try {
    const result = await runAi({
      maxTokens: 3000,
      system: PIPELINE_POSTS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPipelinePostsPrompt(input) }]
    });
    if (!result || result.refused) {
      return {
        posts: fallbackPipelinePosts(input),
        reason: "The model was unavailable or declined — built simple announcement posts instead."
      };
    }
    const posts = parsePipelinePosts(result.text);
    if (posts.length === 0) {
      return {
        posts: fallbackPipelinePosts(input),
        reason: "Could not read the post output — built simple announcement posts instead."
      };
    }
    return { posts, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      posts: fallbackPipelinePosts(input),
      reason: `Post writing failed (${message}) — built simple announcement posts instead.`
    };
  }
}
