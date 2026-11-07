import { runAi } from "@/lib/ai";
import { brandPromptBlock, brandViolations } from "@/lib/brand/kit";
import { humanize } from "@/lib/x-posts/voice";
import { breaksPersona, namesAProduct, X_EXAMPLES, X_FACTS, X_VOICE_RULES } from "@/lib/x-drafts/voice";
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

export function draftsPrompt(input: { date: string; count: number; recentOpenings: string[] }): { system: string; prompt: string } {
  const system = `You ghostwrite X posts for Nic, a builder who livestreams AI agents building software. Each post also goes to his Threads.

${brandPromptBlock("x")}

Output strict JSON only.`;
  const recent = input.recentOpenings.length ? input.recentOpenings.slice(0, 60).map((line) => `- ${line}`).join("\n") : "- (none yet)";
  const prompt = `Write ${input.count + 3} new X posts for ${input.date}, in Nic's voice. Every post is a different idea.

How his posts work:
${X_VOICE_RULES.map((rule) => `- ${rule}`).join("\n")}

Facts you may use (nothing else about his life or results):
${X_FACTS.map((fact) => `- ${fact}`).join("\n")}

Posts of his that did well, for voice only (never reuse their hooks):
${X_EXAMPLES.map((example) => `"""\n${example}\n"""`).join("\n")}

Hooks he has already used recently (do not repeat these ideas):
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
}): Promise<{ drafts: XDraft[]; dropped: string[] }> {
  const { system, prompt } = draftsPrompt({ date: input.date, count: input.times.length, recentOpenings: input.recentOpenings });
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
