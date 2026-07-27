import { aiConfigured, runAi } from "@/lib/ai";
import { POST_LIBRARY, REPLY_LIBRARY } from "@/lib/x-posts/library";
import { xDailyPackSchema } from "@/lib/storage/schemas";
import type { XDailyPack, XPostFormat, XSuggestedPost, XSuggestedReply } from "@/types/domain";

/**
 * Server-side generation of the X/Threads pack: 24 fresh original posts (each
 * with a reworded Threads variant) spread across the waking day with human
 * jitter, plus 20 evergreen replies. Every press of Generate writes a brand
 * new pack. Prefers Claude (fresh writing against the positioning brief,
 * avoiding topics from recent packs); degrades to the built-in idea library
 * when the API key is missing or the call fails, so the tool never comes up
 * empty.
 */

export const POSTS_PER_PACK = 24;
export const REPLIES_PER_PACK = 20;

export function plannerConfigured() {
  return aiConfigured();
}

/** Deterministic 32-bit FNV-1a hash — used to jitter times repeatably per day. */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Posting slots spread evenly from ~7:15 to ~22:15 local across however many
 * posts the pack carries. Each slot gets ±10 minutes of date-seeded jitter so
 * the schedule never looks machine-regular (exactly-on-the-hour posting every
 * day is a classic automation fingerprint).
 */
export function scheduleTimes(date: string, count = POSTS_PER_PACK): string[] {
  const startMinutes = 7 * 60 + 15;
  const spanMinutes = 15 * 60; // ~7:15 → ~22:15
  const gap = count > 1 ? spanMinutes / (count - 1) : 0;
  return Array.from({ length: count }, (_, index) => {
    const jitter = (hash32(`${date}:${index}`) % 21) - 10;
    const total = Math.round(startMinutes + index * gap + jitter);
    const hours = Math.floor(total / 60) % 24;
    const minutes = total % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  });
}

const POST_FORMATS: XPostFormat[] = ["insight", "contrarian", "story", "question", "framework", "observation"];

function normalizeFormat(value: unknown): XPostFormat {
  return POST_FORMATS.includes(value as XPostFormat) ? (value as XPostFormat) : "insight";
}

interface RawPost {
  format?: unknown;
  topic?: unknown;
  text?: unknown;
  threadsVariant?: unknown;
}

interface RawReply {
  scenario?: unknown;
  text?: unknown;
}

function buildPack(input: {
  date: string;
  focus: string;
  source: "ai" | "library";
  requestedAt?: string;
  posts: Array<{ format: XPostFormat; topic: string; text: string; threadsVariant: string }>;
  replies: Array<{ scenario: string; text: string }>;
}): XDailyPack {
  const times = scheduleTimes(input.date, input.posts.length);
  const pack: XDailyPack = {
    id: `xpack-${crypto.randomUUID()}`,
    date: input.date,
    focus: input.focus.trim() || undefined,
    source: input.source,
    posts: input.posts.map((post, index): XSuggestedPost => ({
      id: `xpost-${crypto.randomUUID()}`,
      slot: index + 1,
      time: times[index],
      format: post.format,
      topic: post.topic,
      text: post.text,
      threadsVariant: post.threadsVariant
    })),
    replies: input.replies.map((reply): XSuggestedReply => ({
      id: `xreply-${crypto.randomUUID()}`,
      scenario: reply.scenario,
      text: reply.text
    })),
    requestedAt: input.requestedAt,
    createdAt: new Date().toISOString()
  };
  return xDailyPackSchema.parse(pack);
}

/**
 * Deterministic library rotation: stride through the banks by day so
 * consecutive days always surface a different mix, without persisting any
 * usage state.
 */
export function libraryPack(date: string, focus: string, requestedAt?: string): XDailyPack {
  const dayIndex = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const pick = <T>(bank: T[], count: number, stride: number): T[] =>
    Array.from({ length: count }, (_, i) => bank[(dayIndex * stride + i * Math.max(1, Math.floor(bank.length / count))) % bank.length]);

  const posts = pick(POST_LIBRARY, POSTS_PER_PACK, 7);
  const replies = pick(REPLY_LIBRARY, REPLIES_PER_PACK, 5);
  return buildPack({ date, focus, source: "library", requestedAt, posts, replies });
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function generateDailyPack(input: {
  brief: string;
  date: string;
  focus: string;
  recentTopics: string[];
  requestedAt?: string;
}): Promise<{ pack: XDailyPack; reason: string | null }> {
  const { brief, date, focus, recentTopics, requestedAt } = input;

  if (!plannerConfigured()) {
    return {
      pack: libraryPack(date, focus, requestedAt),
      reason: "AI is not configured — served today's pack from the built-in idea library instead of fresh AI writing."
    };
  }

  const avoid = recentTopics.length ? recentTopics.join("; ") : "(none yet)";
  const focusLine = focus.trim() || "(open — no specific focus today)";

  const userPrompt = `Here is my X/Threads positioning brief:

${brief}

Topics my recent daily packs already covered (do NOT repeat these angles):
${avoid}

Today's optional focus topic: ${focusLine}

Write today's content pack:

1. Exactly ${POSTS_PER_PACK} ORIGINAL standalone posts. Each must be a specific, insightful, non-generic thought in my voice (see voice rules in the brief). Every single post must take a DIFFERENT angle — no two posts in the set may circle the same idea. Vary the formats across the set: insight, contrarian, story, question, framework, observation. At most 4 of the ${POSTS_PER_PACK} may touch CoLateral, and only obliquely — the rest build the personal brand (verification, judgment, agentic engineering, vertical AI, professional workflows). Keep each under 270 characters. For each post also write "threadsVariant": the same idea rephrased for Threads (slightly warmer/more conversational, different wording so the two feeds are not duplicates).

2. Exactly ${REPLIES_PER_PACK} evergreen REPLIES I can adapt when engaging with typical conversations in my space. For each, give "scenario" (one line describing the kind of post it answers, e.g. "Someone ships an impressive AI demo") and "text" (the reply, 2-4 sentences, adds a genuine engineering/professional-workflow perspective, never salesy).

Follow every voice rule: no hashtags, no emojis, no generic openers, no invented facts or numbers, no motivational-influencer tone.

Respond with ONLY valid JSON, no commentary, in exactly this shape:
{"posts":[{"format":"insight","topic":"short topic label","text":"...","threadsVariant":"..."}],"replies":[{"scenario":"...","text":"..."}]}`;

  try {
    const result = await runAi({
      // A 24-post, 20-reply pack measured out at ~32k tokens once the model's
      // reasoning is paid for out of the same budget. Asking for that up front
      // skips a doomed first attempt that costs a minute and a half.
      maxTokens: 32000,
      system:
        "You are a sharp ghostwriter for a structural engineer who builds AI tooling (CoLateral AI). You write specific, credible, non-generic social posts in his voice. You never fabricate facts, projects, or numbers. You output strict JSON when asked.",
      messages: [{ role: "user", content: userPrompt }]
    });

    if (!result || result.refused) {
      return { pack: libraryPack(date, focus, requestedAt), reason: "The model was unavailable or declined — served the built-in idea library instead." };
    }

    const text = result.text.trim();

    const parsed = extractJson(text) as { posts?: RawPost[]; replies?: RawReply[] };
    const posts = (parsed.posts ?? [])
      .filter((post) => typeof post.text === "string" && post.text.trim())
      .slice(0, POSTS_PER_PACK)
      .map((post) => ({
        format: normalizeFormat(post.format),
        topic: typeof post.topic === "string" && post.topic.trim() ? post.topic.trim() : "untitled angle",
        text: String(post.text).trim(),
        threadsVariant:
          typeof post.threadsVariant === "string" && post.threadsVariant.trim()
            ? post.threadsVariant.trim()
            : String(post.text).trim()
      }));
    const replies = (parsed.replies ?? [])
      .filter((reply) => typeof reply.text === "string" && reply.text.trim())
      .slice(0, REPLIES_PER_PACK)
      .map((reply) => ({
        scenario: typeof reply.scenario === "string" && reply.scenario.trim() ? reply.scenario.trim() : "General conversation",
        text: String(reply.text).trim()
      }));

    // Top up any shortfall from the library so the pack is always complete.
    const fallback = libraryPack(date, focus, requestedAt);
    while (posts.length < POSTS_PER_PACK) {
      const fill = fallback.posts[posts.length];
      posts.push({ format: fill.format, topic: fill.topic, text: fill.text, threadsVariant: fill.threadsVariant });
    }
    while (replies.length < REPLIES_PER_PACK) {
      const fill = fallback.replies[replies.length];
      replies.push({ scenario: fill.scenario, text: fill.text });
    }

    return { pack: buildPack({ date, focus, source: "ai", requestedAt, posts, replies }), reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      pack: libraryPack(date, focus, requestedAt),
      reason: `AI generation failed (${message}) — served the built-in idea library instead.`
    };
  }
}
