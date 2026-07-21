import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL_KEYWORDS } from "@/lib/clipping/titles";
import { SFX_SOUNDS } from "@/lib/sfx/types";
import { videoScriptSchema } from "@/lib/storage/schemas";
import type { ScriptGraphic, ScriptSection, ScriptSfx, VideoIdea, VideoScript } from "@/types/domain";

/**
 * Script generation. Takes an idea (or a bare title/topic) plus the channel's
 * stored script framework and writes the full script — every section written
 * out word-for-word — along with a production kit: suggested graphics
 * (b-roll / screen recordings / diagrams / text overlays) and sound-effect
 * cues, each tied to a section and managed (accepted / dismissed) by hand.
 *
 * House AI pattern: *Configured() gate, pure prompt builder, tolerant
 * parser, graceful skeleton fallback.
 */

export function scriptGenerationConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const GRAPHIC_KINDS = ["b-roll", "screen-recording", "diagram", "text-overlay", "meme", "photo"] as const;

export const SCRIPT_SYSTEM_PROMPT = `You are the scriptwriter for a YouTube channel about building software with AI.

Channel context: the creator is a structural engineer building CoLateral (an AI-powered workspace for structural engineers) with AI coding tools, sharing the journey. Channel keywords to weave in naturally: ${CHANNEL_KEYWORDS.join(", ")}.

You write COMPLETE scripts — the actual words to say, not outlines. Rules:
- Follow the creator's script framework exactly (provided with each request): its sections, its ordering, its voice rules.
- Write in his voice: sharp engineer, plain words, short sentences, contractions, first person.
- Never invent numbers, results, revenue, clients, or capabilities. Where a real detail must come from him, write it as a bracketed slot like [YOUR NUMBER HERE].
- Every section gets spoken content sized so the whole script fits the target length at ~150 words per minute.

You also propose the production kit:
- "graphics": for each section, the visuals that should be on screen — kind is one of ${GRAPHIC_KINDS.join(" | ")}, description says exactly what to capture or make.
- "sfx": sound-effect cues — the exact line/moment and the sound. Prefer the built-in sounds when they fit: ${SFX_SOUNDS.map((s) => `"${s.label}" (${s.description})`).join("; ")}. Use them sparingly — 3-6 cues per video, on punchlines and reveals.

You always return strict JSON.`;

/** Builds the script prompt. Pure, for tests. */
export function buildScriptPrompt(input: {
  framework: string;
  title: string;
  angle?: string;
  keywords?: string[];
  targetMinutes: number;
}): string {
  return [
    "My script framework:",
    "",
    input.framework,
    "",
    "---",
    "",
    `Write the full script for this video:`,
    `Title: ${input.title}`,
    input.angle?.trim() ? `Angle / promise: ${input.angle.trim()}` : "",
    input.keywords?.length ? `Target keywords (work them into the spoken words naturally): ${input.keywords.join(", ")}` : "",
    `Target length: about ${input.targetMinutes} minutes (~${input.targetMinutes * 150} words of spoken content).`,
    "",
    'Respond with ONLY valid JSON in exactly this shape:',
    '{"sections":[{"name":"Hook","purpose":"what this section accomplishes","content":"the exact words to say"}],"graphics":[{"section":"Hook","kind":"screen-recording","description":"..."}],"sfx":[{"section":"Hook","cue":"right after the line \'...\'","sound":"Vine boom"}]}'
  ]
    .filter(Boolean)
    .join("\n");
}

type ParsedScript = {
  sections: ScriptSection[];
  graphics: ScriptGraphic[];
  sfx: ScriptSfx[];
};

/** Parses the model reply into sections + production kit, keyed by section name. */
export function parseScript(text: string): ParsedScript | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as {
      sections?: Array<Record<string, unknown>>;
      graphics?: Array<Record<string, unknown>>;
      sfx?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) return null;

    const sections: ScriptSection[] = parsed.sections
      .filter((section) => typeof section.name === "string" && typeof section.content === "string")
      .map((section) => ({
        id: `sec-${crypto.randomUUID().slice(0, 8)}`,
        name: String(section.name).trim() || "Section",
        purpose: typeof section.purpose === "string" ? section.purpose.trim() : "",
        content: String(section.content).trim()
      }));
    if (sections.length === 0) return null;

    const sectionIdByName = new Map(sections.map((section) => [section.name.toLowerCase(), section.id]));
    const resolveSection = (value: unknown): string => {
      if (typeof value !== "string") return "";
      return sectionIdByName.get(value.trim().toLowerCase()) ?? "";
    };

    const graphics: ScriptGraphic[] = (parsed.graphics ?? [])
      .filter((graphic) => typeof graphic.description === "string" && (graphic.description as string).trim())
      .map((graphic) => ({
        id: `gfx-${crypto.randomUUID().slice(0, 8)}`,
        sectionId: resolveSection(graphic.section),
        kind: GRAPHIC_KINDS.includes(graphic.kind as (typeof GRAPHIC_KINDS)[number])
          ? (graphic.kind as ScriptGraphic["kind"])
          : "b-roll",
        description: String(graphic.description).trim(),
        status: "suggested" as const
      }));

    const sfx: ScriptSfx[] = (parsed.sfx ?? [])
      .filter((cue) => typeof cue.cue === "string" && (cue.cue as string).trim())
      .map((cue) => ({
        id: `sfx-${crypto.randomUUID().slice(0, 8)}`,
        sectionId: resolveSection(cue.section),
        cue: String(cue.cue).trim(),
        sound: typeof cue.sound === "string" ? cue.sound.trim() : "",
        status: "suggested" as const
      }));

    return { sections, graphics, sfx };
  } catch {
    return null;
  }
}

/** Offline fallback: the framework as an empty skeleton to write into. */
export function skeletonScript(framework: string): ParsedScript {
  const names = [...framework.matchAll(/^##\s*\d*\.?\s*([^\n(]+)/gm)]
    .map((match) => match[1].trim())
    .filter(Boolean)
    .filter((name) => !/voice rules/i.test(name));
  const sections = (names.length ? names : ["Hook", "Context & Stakes", "Value Beats", "Payoff", "CTA"]).map((name) => ({
    id: `sec-${crypto.randomUUID().slice(0, 8)}`,
    name,
    purpose: "",
    content: ""
  }));
  return { sections, graphics: [], sfx: [] };
}

/** Assembles the persisted record. */
export function toScriptRecord(input: {
  parsed: ParsedScript;
  title: string;
  ideaId?: string;
  targetMinutes: number;
  source: VideoScript["source"];
}): VideoScript {
  const now = new Date().toISOString();
  return videoScriptSchema.parse({
    id: `script-${crypto.randomUUID()}`,
    ideaId: input.ideaId,
    title: input.title,
    targetMinutes: input.targetMinutes,
    sections: input.parsed.sections,
    graphics: input.parsed.graphics,
    sfx: input.parsed.sfx,
    status: "draft",
    source: input.source,
    createdAt: now,
    updatedAt: now
  }) as VideoScript;
}

/** The full spoken script as one copyable/teleprompter-ready text. */
export function scriptFullText(script: Pick<VideoScript, "title" | "sections">): string {
  return [
    script.title,
    "",
    ...script.sections.flatMap((section) => [`## ${section.name}`, "", section.content, ""])
  ].join("\n");
}

/**
 * Writes a full script for an idea (or bare title) in one Claude call.
 * Never throws — falls back to a framework skeleton with a reason.
 */
export async function generateScript(input: {
  framework: string;
  title: string;
  angle?: string;
  keywords?: string[];
  targetMinutes: number;
  idea?: VideoIdea;
}): Promise<{ script: VideoScript; reason: string | null }> {
  const fallback = () =>
    toScriptRecord({
      parsed: skeletonScript(input.framework),
      title: input.title,
      ideaId: input.idea?.id,
      targetMinutes: input.targetMinutes,
      source: "manual"
    });

  if (!scriptGenerationConfigured()) {
    return {
      script: fallback(),
      reason: "ANTHROPIC_API_KEY is not set — created an empty framework skeleton to write into instead."
    };
  }
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      system: SCRIPT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildScriptPrompt({
            framework: input.framework,
            title: input.title,
            angle: input.angle ?? input.idea?.angle,
            keywords: input.keywords ?? input.idea?.keywords,
            targetMinutes: input.targetMinutes
          })
        }
      ]
    });
    if (response.stop_reason === "refusal") {
      return { script: fallback(), reason: "The model declined the request — created a framework skeleton instead." };
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const parsed = parseScript(text);
    if (!parsed) {
      return { script: fallback(), reason: "Could not read the script output — created a framework skeleton instead." };
    }
    return {
      script: toScriptRecord({
        parsed,
        title: input.title,
        ideaId: input.idea?.id,
        targetMinutes: input.targetMinutes,
        source: "ai"
      }),
      reason: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { script: fallback(), reason: `Script generation failed (${message}) — created a framework skeleton instead.` };
  }
}
