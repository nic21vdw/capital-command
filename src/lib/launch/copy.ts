import { runAi } from "@/lib/ai";
import { CHANNEL_KEYWORDS } from "@/lib/clipping/keywords";
import type { LaunchCopy } from "@/lib/launch/types";

/** Product Hunt truncates anything longer in the feed. */
export const MAX_TAGLINE_CHARS = 60;
const MAX_DESCRIPTION_CHARS = 260;

export interface LaunchCopyInput {
  product: string;
  productUrl: string;
  audience: string;
  whatItDoes: string;
  differentiator: string;
}

export const LAUNCH_COPY_SYSTEM_PROMPT = `You are a launch strategist who has shipped dozens of Product Hunt launches for small, founder-built software.

Channel context: the maker is a structural engineer who builds his product live with AI coding tools and teaches AI, coding and business to an audience of builders. Recurring keywords for the social posts only, used when they genuinely fit: ${CHANNEL_KEYWORDS.join(", ")}.

House rules for every piece of copy:
- Write like the founder, not like a press release. No "revolutionary", "game-changing", "seamlessly", "empower", or "unlock".
- Be concrete about what the product actually does. A reader who has never heard of it should understand it from the tagline alone.
- Never ask anyone to upvote — Product Hunt penalises it.
- No emoji in the tagline or description. At most one in a social post, and only if it earns its place.

You always return strict JSON.`;

/** Builds the copy prompt. Pure, for tests. */
export function buildLaunchCopyPrompt(input: LaunchCopyInput): string {
  return [
    `Product name: ${input.product}`,
    `Website: ${input.productUrl || "(not given)"}`,
    `Who it is for: ${input.audience || "(not given)"}`,
    `What it does: ${input.whatItDoes || "(not given)"}`,
    `Why it is different: ${input.differentiator || "(not given)"}`,
    "",
    "Write the full Product Hunt launch kit for this product.",
    "",
    'Return ONLY a JSON object: {"tagline": string, "description": string, "firstComment": string, "topics": string[], "galleryCaptions": string[], "socialPosts": [{"surface": string, "text": string}]}',
    `- "tagline": at most ${MAX_TAGLINE_CHARS} characters, no trailing period, says what the product is.`,
    `- "description": 2-3 sentences, at most ${MAX_DESCRIPTION_CHARS} characters.`,
    '- "firstComment": the maker\'s first comment, 120-200 words. Cover why you built it, who it is for, what is deliberately not in it yet, and end with one specific question that invites a reply.',
    '- "topics": 3 existing Product Hunt topic names, most relevant first.',
    '- "galleryCaptions": 5 captions, one per gallery image, in the order they should be shown so they read as a story.',
    '- "socialPosts": exactly 4 launch-day posts, one each with "surface" set to "x", "threads", "linkedin", and "youtube-community". Each written natively for that surface, linking the launch without begging for votes.'
  ].join("\n");
}

/** Pulls the copy object out of the reply, tolerating fences / prose. Pure. */
export function parseLaunchCopy(text: string): Omit<LaunchCopy, "name" | "generatedAt" | "aiGenerated"> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }

  const tagline = typeof parsed.tagline === "string" ? parsed.tagline.trim().slice(0, MAX_TAGLINE_CHARS) : "";
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  const firstComment = typeof parsed.firstComment === "string" ? parsed.firstComment.trim() : "";
  if (!tagline || !description || !firstComment) return null;

  const strings = (value: unknown, limit: number) =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .slice(0, limit)
      : [];

  const socialPosts = Array.isArray(parsed.socialPosts)
    ? parsed.socialPosts
        .map((entry) => entry as Record<string, unknown>)
        .filter((entry) => typeof entry?.surface === "string" && typeof entry?.text === "string")
        .map((entry) => ({ surface: String(entry.surface).trim(), text: String(entry.text).trim() }))
        .filter((entry) => entry.surface && entry.text)
        .slice(0, 6)
    : [];

  return {
    tagline,
    description,
    firstComment,
    topics: strings(parsed.topics, 3),
    galleryCaptions: strings(parsed.galleryCaptions, 6),
    socialPosts
  };
}

/** Offline draft: still a usable skeleton to edit, built from the answers given. */
export function fallbackLaunchCopy(input: LaunchCopyInput): LaunchCopy {
  const audience = input.audience.trim() || "the people it was built for";
  const does = input.whatItDoes.trim() || "does the job you keep doing by hand";
  const different = input.differentiator.trim() || "it is built by someone who does this work every day";

  return {
    name: input.product,
    tagline: `${input.product}: ${does}`.slice(0, MAX_TAGLINE_CHARS),
    description: `${input.product} ${does}. Built for ${audience}. ${different}.`.slice(0, MAX_DESCRIPTION_CHARS),
    firstComment: [
      `Hey Product Hunt — I'm the maker of ${input.product}.`,
      "",
      `I built it because ${different.toLowerCase()}. It ${does}, and it is aimed squarely at ${audience}.`,
      "",
      "It is early and deliberately narrow — there is plenty it does not do yet, and I would rather it do one thing properly first.",
      "",
      "What is the part of this workflow that wastes the most of your time right now?"
    ].join("\n"),
    topics: ["Artificial Intelligence", "Productivity", "SaaS"],
    galleryCaptions: [
      "The problem, in one screen",
      `${input.product} doing the thing`,
      "The part that saves the most time",
      "What it looks like on real work",
      "Where it is going next"
    ],
    socialPosts: [
      { surface: "x", text: `${input.product} is live on Product Hunt today. ${does}. ${input.productUrl}`.trim() },
      { surface: "threads", text: `Shipped it. ${input.product} — ${does} — is on Product Hunt today. ${input.productUrl}`.trim() },
      {
        surface: "linkedin",
        text: `${input.product} launched on Product Hunt today. It ${does}, built for ${audience}. ${input.productUrl}`.trim()
      },
      { surface: "youtube-community", text: `${input.product} is live on Product Hunt. Full build story on the channel. ${input.productUrl}`.trim() }
    ],
    generatedAt: new Date().toISOString(),
    aiGenerated: false
  };
}

/**
 * Writes the whole listing kit. Never throws — falls back to the offline draft
 * so the page always hands back something editable.
 */
export async function generateLaunchCopy(input: LaunchCopyInput): Promise<LaunchCopy> {
  try {
    const result = await runAi({
      maxTokens: 4000,
      temperature: 0.6,
      system: LAUNCH_COPY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildLaunchCopyPrompt(input) }]
    });
    const parsed = result?.text ? parseLaunchCopy(result.text) : null;
    if (parsed) {
      return { ...parsed, name: input.product, generatedAt: new Date().toISOString(), aiGenerated: true };
    }
  } catch {
    // Fall through to the offline draft.
  }
  return fallbackLaunchCopy(input);
}
