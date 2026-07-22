import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL_KEYWORDS, TITLE_STYLE_EXAMPLES } from "@/lib/clipping/titles";
import { videoIdeaSchema } from "@/lib/storage/schemas";
import type { VideoIdea, VideoIdeaCompetition, VideoIdeaFormat, VideoIdeaIntent } from "@/types/domain";

/**
 * Idea Lab: keyword-driven video idea discovery. A seed keyword (or none —
 * then the channel keyword set drives it) expands into scored video ideas:
 * working title in the channel voice, angle, search intent, related keywords
 * and a competition estimate. When competitor outliers are available from the
 * Outlier Radar they are fed in as "what is working in the niche right now".
 *
 * Follows the house AI pattern: *Configured() gate, pure prompt builder,
 * tolerant parser, graceful library fallback so the button never comes up
 * empty.
 */

export const IDEAS_PER_RUN = 12;

export function ideaResearchConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const FORMATS: VideoIdeaFormat[] = ["longform", "short", "both"];
const INTENTS: VideoIdeaIntent[] = ["tutorial", "case-study", "opinion", "story", "comparison", "news"];
const COMPETITION: VideoIdeaCompetition[] = ["low", "medium", "high"];

export const IDEA_RESEARCH_SYSTEM_PROMPT = `You are a YouTube keyword-research and ideation strategist.

Channel context: the creator live-streams and records himself building CoLateral (an AI-powered workspace for structural engineers) with AI coding tools, and teaches what he learns about AI, coding and business. Channel keywords: ${CHANNEL_KEYWORDS.join(", ")}.

The channel's title voice (working titles must match this style):
${TITLE_STYLE_EXAMPLES.map((t) => `- ${t}`).join("\n")}

For every idea you propose:
- "title": a working title in the channel voice — complete phrase, Title Case, under 75 characters, no emoji/hashtags/quotes.
- "angle": one sentence on the promise — what makes this both SEARCHED FOR and CLICKED.
- "format": "longform", "short", or "both".
- "primaryKeyword": the single search phrase this targets.
- "keywords": 4-8 related search phrases (what people actually type).
- "searchIntent": one of ${INTENTS.join(" | ")}.
- "competition": your honest estimate ("low" | "medium" | "high") of how crowded the primary keyword is on YouTube.
- "score": 0-100 opportunity score weighing demand, competition, and fit with this channel's authority (a structural engineer who ships real AI software beats generic AI content only where that authority matters).
- "rationale": one sentence on why the score.

Never propose ideas that require fabricating results, revenue or clients. You always return strict JSON.`;

/** Builds the research prompt. Pure, for tests. */
export function buildIdeaResearchPrompt(input: {
  seed: string;
  outlierTitles: string[];
  existingTitles: string[];
}): string {
  const lines: string[] = [];
  if (input.seed.trim()) {
    lines.push(`Seed keyword / topic to research: "${input.seed.trim()}"`);
  } else {
    lines.push("No seed keyword — mine the channel keywords and what's working in the niche.");
  }
  if (input.outlierTitles.length) {
    lines.push(
      "",
      "Videos currently overperforming on competitor channels in this niche (real outlier data — use it to read demand):",
      ...input.outlierTitles.slice(0, 20).map((t) => `- ${t}`)
    );
  }
  if (input.existingTitles.length) {
    lines.push(
      "",
      "Ideas already on my board (do NOT repeat these or near-duplicates):",
      ...input.existingTitles.slice(0, 40).map((t) => `- ${t}`)
    );
  }
  lines.push(
    "",
    `Propose exactly ${IDEAS_PER_RUN} distinct video ideas, strongest opportunity first. Spread them across search intents and formats — not twelve tutorials.`,
    "",
    'Respond with ONLY valid JSON: {"ideas":[{"title":"...","angle":"...","format":"longform","primaryKeyword":"...","keywords":["..."],"searchIntent":"tutorial","competition":"medium","score":72,"rationale":"..."}]}'
  );
  return lines.join("\n");
}

type RawIdea = Record<string, unknown>;

function normalizeEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Pulls ideas out of the model reply, tolerating fences/prose; drops junk. */
export function parseIdeaResearch(text: string): Array<Omit<VideoIdea, "id" | "seedKeyword" | "status" | "source" | "createdAt">> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { ideas?: RawIdea[] };
    if (!Array.isArray(parsed.ideas)) return [];
    return parsed.ideas
      .filter((idea) => typeof idea.title === "string" && (idea.title as string).trim().length > 0)
      .slice(0, IDEAS_PER_RUN)
      .map((idea) => ({
        title: String(idea.title).trim().slice(0, 110),
        angle: typeof idea.angle === "string" ? idea.angle.trim() : "",
        format: normalizeEnum(idea.format, FORMATS, "longform"),
        primaryKeyword: typeof idea.primaryKeyword === "string" ? idea.primaryKeyword.trim() : "",
        keywords: Array.isArray(idea.keywords)
          ? idea.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean).slice(0, 10)
          : [],
        searchIntent: normalizeEnum(idea.searchIntent, INTENTS, "tutorial"),
        competition: normalizeEnum(idea.competition, COMPETITION, "medium"),
        score: Math.max(0, Math.min(100, Math.round(Number(idea.score) || 50))),
        rationale: typeof idea.rationale === "string" ? idea.rationale.trim() : ""
      }));
  } catch {
    return [];
  }
}

/** Offline fallback: keyword-template combinations that are honest and usable. */
export function libraryIdeas(seed: string): Array<Omit<VideoIdea, "id" | "seedKeyword" | "status" | "source" | "createdAt">> {
  const topic = seed.trim() || "AI coding";
  const templates: Array<{ title: string; angle: string; intent: VideoIdeaIntent; format: VideoIdeaFormat }> = [
    { title: `How I Use ${topic} to Build Real Software`, angle: `A concrete walkthrough of ${topic} on a real project.`, intent: "tutorial", format: "longform" },
    { title: `${topic}: What Nobody Tells Beginners`, angle: `The honest gotchas of ${topic} from real use.`, intent: "opinion", format: "both" },
    { title: `I Tried ${topic} for 30 Days — Here's What Happened`, angle: `A results-first story about ${topic}.`, intent: "story", format: "longform" },
    { title: `${topic} vs Doing It Manually`, angle: `A fair comparison with real timings.`, intent: "comparison", format: "longform" },
    { title: `The ${topic} Mistake That Cost Me a Week`, angle: `A specific failure and the fix.`, intent: "case-study", format: "both" },
    { title: `${topic} for Engineers Who Ship`, angle: `Applying ${topic} in a professional workflow.`, intent: "tutorial", format: "longform" }
  ];
  return templates.map((template, index) => ({
    title: template.title.length > 95 ? `${template.title.slice(0, 94)}…` : template.title,
    angle: template.angle,
    format: template.format,
    primaryKeyword: topic.toLowerCase(),
    keywords: [topic.toLowerCase(), ...CHANNEL_KEYWORDS.slice(0, 4).map((k) => k.toLowerCase())],
    searchIntent: template.intent,
    competition: "medium" as VideoIdeaCompetition,
    score: 55 - index * 2,
    rationale: "Offline template idea — set ANTHROPIC_API_KEY for researched ideas."
  }));
}

/** Stamps parsed idea bodies into full persisted VideoIdea records. */
export function toIdeaRecords(
  bodies: Array<Omit<VideoIdea, "id" | "seedKeyword" | "status" | "source" | "createdAt">>,
  seed: string,
  source: VideoIdea["source"]
): VideoIdea[] {
  const now = new Date().toISOString();
  return bodies.map((body) =>
    videoIdeaSchema.parse({
      ...body,
      id: `idea-${crypto.randomUUID()}`,
      seedKeyword: seed.trim(),
      status: "suggested",
      source,
      createdAt: now
    })
  );
}

/**
 * Runs one idea-research pass. Returns fresh `suggested` idea records and a
 * reason string when it had to fall back. Never throws.
 */
export async function generateIdeas(input: {
  seed: string;
  outlierTitles: string[];
  existingTitles: string[];
}): Promise<{ ideas: VideoIdea[]; reason: string | null }> {
  if (!ideaResearchConfigured()) {
    return {
      ideas: toIdeaRecords(libraryIdeas(input.seed), input.seed, "library"),
      reason: "ANTHROPIC_API_KEY is not set — served template ideas instead of researched ones."
    };
  }
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 6000,
      system: IDEA_RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildIdeaResearchPrompt(input) }]
    });
    if (response.stop_reason === "refusal") {
      return {
        ideas: toIdeaRecords(libraryIdeas(input.seed), input.seed, "library"),
        reason: "The model declined the request — served template ideas instead."
      };
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const bodies = parseIdeaResearch(text);
    if (bodies.length === 0) {
      return {
        ideas: toIdeaRecords(libraryIdeas(input.seed), input.seed, "library"),
        reason: "Could not read the research output — served template ideas instead."
      };
    }
    return { ideas: toIdeaRecords(bodies, input.seed, "ai"), reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ideas: toIdeaRecords(libraryIdeas(input.seed), input.seed, "library"),
      reason: `Idea research failed (${message}) — served template ideas instead.`
    };
  }
}
