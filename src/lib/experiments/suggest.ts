import { aiConfigured, runAi } from "@/lib/ai";
import { viralTitleSystemPrompt, cleanViralTitle } from "@/lib/clipping/titles";
import { applyBrandRules, brandPromptBlock } from "@/lib/brand/kit";
import { normalizeTitle } from "@/lib/publisher/duplicates";
import { MAX_HOOK_LENGTH, type ExperimentKind } from "@/lib/experiments/types";

const MAX_TRANSCRIPT_CHARS = 700;

const HOOK_SYSTEM_PROMPT = `You write the opening line of a social post caption for a short vertical video, the sentence that decides whether someone keeps reading.

Every opening line must:
- Be one complete sentence under 140 characters.
- Lead with curiosity, stakes or a bold claim drawn from what is actually said in the clip.
- Contain no quotation marks, hashtags or emoji.

You always return strict JSON.`;

export type VariantRequest = { kind: ExperimentKind; base: string; transcript: string; count: number };

export function buildVariantPrompt(request: VariantRequest): { system: string; user: string } {
  const excerpt = request.transcript.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_CHARS);
  const noun = request.kind === "hook" ? "opening lines" : "titles";
  const user = [
    `The clip currently uses this ${request.kind === "hook" ? "opening line" : "title"}: ${request.base}`,
    "",
    `Write ${request.count} alternative ${noun} for the same clip. Each must take a different angle from the current one and from each other, so a test between them says something.`,
    "",
    "Return ONLY a JSON array of strings, no prose.",
    "",
    "What is said in the clip:",
    excerpt
  ].join("\n");
  return { system: request.kind === "hook" ? `${HOOK_SYSTEM_PROMPT}\n\n${brandPromptBlock("youtube", { titleOnly: true })}` : viralTitleSystemPrompt(), user };
}

function cleanHook(raw: string): string {
  const cleaned = applyBrandRules(raw, "youtube")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/#[\w-]+/g, " ")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.split(/\s+/).length < 3 || cleaned.length > MAX_HOOK_LENGTH) return "";
  return cleaned;
}

export function parseVariants(text: string, kind: ExperimentKind, base: string, count: number): string[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set([normalizeTitle(base)]);
  const out: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const cleaned = kind === "hook" ? cleanHook(entry) : cleanViralTitle(entry);
    const key = normalizeTitle(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= count) break;
  }
  return out;
}

export async function suggestVariants(request: VariantRequest): Promise<string[] | null> {
  if (!aiConfigured()) return null;
  const prompt = buildVariantPrompt(request);
  try {
    const result = await runAi({ maxTokens: 800, system: prompt.system, messages: [{ role: "user", content: prompt.user }] });
    if (!result || result.refused) return null;
    const variants = parseVariants(result.text, request.kind, request.base, request.count);
    return variants.length > 0 ? variants : null;
  } catch {
    return null;
  }
}
