import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { fetchJson } from "@/lib/publisher/http";
import { debitOrSkip } from "@/lib/youtube/quotaSpend";
import { runAi } from "@/lib/ai";
import { brandPromptBlock, brandViolations } from "@/lib/brand/kit";
import { humanize } from "@/lib/x-posts/voice";
import { breaksPersona, endsOnCallToAction, namesAProduct, X_EXAMPLES, X_FACTS, X_VOICE_RULES } from "@/lib/x-drafts/voice";
import { FACT_TOPICS, factTopics, type DatedFact, type FactTopic } from "@/lib/x-drafts/facts";
import type { XDraft } from "@/lib/x-drafts/types";

export const X_DRAFT_MIN = 90;
export const X_DRAFT_MAX = 480;

const LINK = /\b(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|dev|app|co)\b)|\blink (?:below|in (?:the )?(?:bio|reply|replies))\b/i;
const BLOCKING_KINDS = new Set(["banned-phrase", "banned-claim", "retired-name", "hashtag", "emoji"]);

export type RawDraft = { topic?: unknown; text?: unknown; reply?: unknown };

export function draftProblem(text: string): string | null {
  if (text.length < X_DRAFT_MIN) return "too short";
  if (text.length > X_DRAFT_MAX) return "too long for Threads";
  if (LINK.test(text)) return "has a link in the post";
  if (breaksPersona(text)) return "talks about engineering work";
  const firstLine = text.split("\n")[0] ?? "";
  if (!namesAProduct(firstLine)) return "the hook names no model or product";
  if (!endsOnCallToAction(text)) return "ends without a call to action";
  if (brandViolations(text, "x").some((violation) => BLOCKING_KINDS.has(violation.kind))) return "breaks a brand rule";
  return null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

export function cleanDraftText(raw: string, seed: string): string {
  const paragraphs = raw
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  return humanize(paragraphs.join("\n\n"), seed, { typoRate: 0, channel: "x" }).trim();
}

export function parseDrafts(input: {
  raw: string;
  date: string;
  times: string[];
  recentOpenings: string[];
  now: Date;
  newId?: () => string;
}): { drafts: XDraft[]; dropped: string[] } {
  const nextId = input.newId ?? (() => `xdraft-${crypto.randomUUID()}`);
  const cleaned = input.raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("the writer did not return JSON");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { drafts?: RawDraft[] };
  const seen = new Set(input.recentOpenings.map(normalize));
  const drafts: XDraft[] = [];
  const dropped: string[] = [];
  for (const [index, entry] of (parsed.drafts ?? []).entries()) {
    if (drafts.length >= input.times.length) break;
    if (typeof entry.text !== "string" || !entry.text.trim()) continue;
    const text = cleanDraftText(entry.text, `${input.date}:${index}`);
    const problem = draftProblem(text);
    const opening = normalize(text.split("\n")[0] ?? "");
    if (problem || seen.has(opening)) {
      dropped.push(`${(text.split("\n")[0] ?? "").slice(0, 60)}: ${problem ?? "repeats an earlier hook"}`);
      continue;
    }
    seen.add(opening);
    const reply = typeof entry.reply === "string" && entry.reply.trim() ? cleanDraftText(entry.reply, `${input.date}:${index}:reply`) : undefined;
    drafts.push({
      id: nextId(),
      batchDate: input.date,
      slot: drafts.length + 1,
      time: input.times[drafts.length],
      topic: typeof entry.topic === "string" && entry.topic.trim() ? entry.topic.trim().slice(0, 60) : "Hot take",
      text,
      ...(reply && !breaksPersona(reply) ? { reply } : {}),
      status: "new",
      createdAt: input.now.toISOString()
    });
  }
  return { drafts, dropped };
}

export const POST_MIX = [
  "model take: a comparison or power ranking",
  "last night's stream: what the agents built",
  "model take: usage limits, resets or money",
  "a tip: how he actually uses Claude Code or Codex",
  "an A or B question to the audience",
  "model take: a cancel or switch story",
  "a CoLateral or Arcade release, only if a dated fact below gives one, else another model take",
  "a stream milestone, only if a dated fact below gives one, else another model take",
  "model take: a hot take while he is live",
  "an honest build log: what broke tonight"
];

export const TOPIC_SLOTS: Record<FactTopic, string> = {
  stream: "the nightly stream: build on the stream facts below (the day count, what he built, what he learned)",
  channel: "the road to 3,000 subscribers: build on the channel facts below",
  colateral: "something that just shipped in CoLateral: build on one CoLateral fact below",
  arcade: "something new in the CoLateral Arcade: build on one Arcade fact below",
  videos: "a video or Short he just posted: build on one video fact below"
};

const GENERAL_MIX = [
  "model take: a head to head comparison or power ranking",
  "model take: usage limits, resets or money, compared across two plans",
  "a tip: how he actually uses Claude Code or Codex, and where the other one is better",
  "an A or B question to the audience: two models, pick one",
  "model take: a cancel or switch story, from one product to another",
  "model take: a hot take while he is live, comparing two tools he used tonight",
  "an honest build log: what broke tonight and which agent fixed it"
];

export const ANGLES = ["hot take", "head to head", "his own story", "a tip", "a prediction", "an A or B question", "a cancel or switch story"];

function dayNumber(date: string): number {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
}

export function mixFor(count: number, topics: FactTopic[] = [], date = ""): string[] {
  if (topics.length === 0) return Array.from({ length: count }, (_, index) => POST_MIX[index % POST_MIX.length]);
  const shift = dayNumber(date);
  const rotated = topics.map((_, index) => topics[(index + shift) % topics.length]);
  const general = GENERAL_MIX.map((_, index) => GENERAL_MIX[(index + shift) % GENERAL_MIX.length]);
  const mix: string[] = [];
  let topic = 0;
  let other = 0;
  for (let index = 0; index < count; index += 1) {
    if (index % 2 === 1 && topic < rotated.length) mix.push(TOPIC_SLOTS[rotated[topic++]]);
    else mix.push(general[other++ % general.length]);
  }
  return mix;
}

const TOPIC_HEADINGS: Record<FactTopic, string> = {
  stream: "The nightly stream",
  channel: "The channel and the 3,000 subscriber goal",
  colateral: "CoLateral (what shipped)",
  arcade: "The CoLateral Arcade (what went live)",
  videos: "Videos and Shorts he just posted"
};

export function factsBlock(facts: DatedFact[]): string {
  const line = (fact: DatedFact) => `- ${fact.date}: ${fact.text}`;
  const general = facts.filter((fact) => !fact.topic);
  const groups = FACT_TOPICS.map((topic) => ({ topic, facts: facts.filter((fact) => fact.topic === topic) })).filter((group) => group.facts.length);
  return [
    ...(general.length ? [general.map(line).join("\n")] : []),
    ...groups.map((group) => `${TOPIC_HEADINGS[group.topic]}:\n${group.facts.map(line).join("\n")}`)
  ].join("\n\n");
}

export function draftsPrompt(input: { date: string; count: number; recentOpenings: string[]; facts?: DatedFact[] }): { system: string; prompt: string } {
  const system = `You ghostwrite X posts for Nic, a builder who livestreams AI agents building software. Each post also goes to his Threads.

${brandPromptBlock("x")}

Output strict JSON only.`;
  const recent = input.recentOpenings.length ? input.recentOpenings.slice(0, 60).map((line) => `- ${line}`).join("\n") : "- (none yet)";
  const facts = input.facts ?? [];
  const dated = factsBlock(facts);
  const topics = factTopics(facts);
  const mix = mixFor(input.count, topics, input.date).map((kind, index) => `${index + 1}. ${kind}`).join("\n");
  const prompt = `Write ${input.count + 3} new X posts for ${input.date}, in Nic's voice. Every post opens on its own hook.

Put the first ${input.count} in this order, then 3 spares of any kind:
${mix}

${topics.length ? "A post built on a fact below still opens on a hook that names a model or product (Claude Code, Codex, Opus 5.5, CoLateral, the CoLateral Arcade).\n\n" : ""}The same idea may come back from a different angle (${ANGLES.join(", ")}). What may never repeat is a hook, and no two posts in the set may take the same angle on the same idea.

How his posts work. Every post hits all three Cs (controversial but not stupid, a comparison, a call to action) and teaches one thing:
${X_VOICE_RULES.map((rule) => `- ${rule}`).join("\n")}

Facts you may use (nothing else about his life or results):
${X_FACTS.map((fact) => `- ${fact}`).join("\n")}${dated ? `

Dated facts from the last two weeks (use them as written, never stretch a number or a date). They are what he is working on right now, so the set should touch several of these areas, not just one:
${dated}` : ""}

Posts of his that did well, for voice only (never reuse their hooks):
${X_EXAMPLES.map((example) => `"""\n${example}\n"""`).join("\n")}

Hooks he has already used recently (never reuse one; an idea behind them may return only from a new angle):
${recent}

Each post is ${X_DRAFT_MIN + 60}-${X_DRAFT_MAX - 30} characters. At most two posts in the set mention CoLateral, and only where it fits the idea. For those, "reply" is a one-line self-reply that points to CoLateral and ends with [link]. Every other post has no reply.

Never describe CoLateral as engineering, structural or design software, and never mention engineering firms or selling to engineers.

Respond with ONLY this JSON:
{"drafts":[{"topic":"two to four word label","text":"the post, paragraphs separated by \\n\\n","reply":"optional"}]}`;
  return { system, prompt };
}

export async function writeDraftBatch(input: {
  date: string;
  times: string[];
  recentOpenings: string[];
  now: Date;
  facts?: DatedFact[];
}): Promise<{ drafts: XDraft[]; dropped: string[] }> {
  const { system, prompt } = draftsPrompt({ date: input.date, count: input.times.length, recentOpenings: input.recentOpenings, facts: input.facts });
  const result = await runAi({
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 8000,
    temperature: 0.9,
    writer: "claude-code",
    writerSwitch: "X_DRAFTS_WRITER"
  });
  if (!result || result.refused || !result.text.trim()) throw new Error("the writer gave no answer");
  return parseDrafts({ raw: result.text, date: input.date, times: input.times, recentOpenings: input.recentOpenings, now: input.now });
}

type YoutubeProofResult = { items?: Array<{ id?: string; status?: { privacyStatus?: string; uploadStatus?: string } }> };
async function readPublicVideo(id: string): Promise<YoutubeProofResult> {
  await debitOrSkip(1, "channel");
  const token = await youtubeAccessToken();
  return fetchJson<YoutubeProofResult>("https://www.googleapis.com/youtube/v3/videos?part=status&id=" + id, {
    label: "YouTube proof visibility", method: "GET", headers: { Authorization: "Bearer " + token }
  });
}

// Not an XDraft, never returned by writeDraftBatch. Native YouTube /clip IDs
// cannot be verified by videos.list; use the source video with a timestamp.
export async function preparePrivateProofDraft(
  input: { text: string; url: string; recentOpenings: string[] },
  readVideo: typeof readPublicVideo = readPublicVideo
): Promise<{ disposition: "private-preview-only"; text: string; reply: string } | null> {
  const { text, url } = input;
  const match = /^https:\/\/(?:www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})(?:&t=([a-z0-9]+))?|(?:www\.youtube\.com\/(?:live|shorts)\/|youtu\.be\/)([A-Za-z0-9_-]{11})(?:\?t=([a-z0-9]+))?)$/.exec(url);
  if (!match || match[0] !== url || draftProblem(text)) return null;
  const timestamp = match[2] ?? match[4];
  if (timestamp && !/^(?:\d+s?|(?=\d)(?:\d+h)?(?:\d+m)?(?:\d+s)?)$/.test(timestamp)) return null;
  const opening = normalize(text.split("\n")[0] ?? "");
  if (input.recentOpenings.some((line) => normalize(line) === opening)) return null;
  try {
    const id = match[1] ?? match[3];
    const actual = (await readVideo(id)).items?.find((item) => item.id === id);
    if (actual?.status?.privacyStatus !== "public" || actual.status.uploadStatus !== "processed") return null;
    return { disposition: "private-preview-only", text, reply: "See the stream: " + url };
  } catch {
    return null;
  }
}
