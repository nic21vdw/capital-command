import { runAi } from "@/lib/ai";
import { overlayIdeas } from "@/lib/thumbnails/suggestions";
import type { LongformProject } from "@/lib/longform/types";

const MAX_WORDS = 6;
const MAX_CHARS = 34;
const WANTED = 3;

const SYSTEM_PROMPT = [
  "You write the words that go on a YouTube thumbnail.",
  "Rules, all of them hard:",
  "- 3 to 6 words. Never more.",
  "- Only claims the transcript actually supports. Never invent a number, a result or an event.",
  "- Present tense, first person where it fits, no title case, no trailing punctuation.",
  "- Wrap the ONE word worth colouring in *asterisks*.",
  "Answer with a JSON array of 3 strings and nothing else."
].join("\n");

export type ThumbnailHookIdeas = { hooks: string[]; source: "ai" | "offline" };

export async function thumbnailHooks(project: LongformProject, topicId?: string | null): Promise<ThumbnailHookIdeas> {
  const topic = topicId ? project.topics?.find((item) => item.id === topicId) : undefined;
  const title = topic?.title ?? project.name;
  const offline = fallbackHooks(title);

  const transcript = transcriptWindow(project, topic?.start, topic?.end);
  if (!transcript) return { hooks: offline, source: "offline" };

  const result = await runAi({
    maxTokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          `Segment title: ${title}`,
          topic?.summary ? `Summary: ${topic.summary}` : "",
          "",
          "Transcript:",
          transcript
        ]
          .filter(Boolean)
          .join("\n")
      }
    ]
  });

  const parsed = parseHooks(result?.text);
  return parsed.length > 0 ? { hooks: parsed, source: "ai" } : { hooks: offline, source: "offline" };
}

export function fallbackHooks(title: string): string[] {
  return overlayIdeas(title)
    .map((idea) => idea.toLowerCase())
    .map(clampWords)
    .filter(Boolean)
    .slice(0, WANTED);
}

export function parseHooks(text?: string | null): string[] {
  if (!text) return [];
  const match = /\[[\s\S]*\]/.exec(text);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => clampWords(item.trim()))
    .filter((item) => item.length > 0);
  return [...new Set(cleaned)].slice(0, WANTED);
}

function clampWords(line: string): string {
  const words = line.replace(/[."]+$/g, "").split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  const joined = words.join(" ");
  return joined.length <= MAX_CHARS ? joined : words.slice(0, MAX_WORDS - 1).join(" ");
}

function transcriptWindow(project: LongformProject, start?: number, end?: number): string {
  const from = start ?? 0;
  const to = end ?? Number.POSITIVE_INFINITY;
  const text = project.transcript
    .filter((segment) => segment.end > from && segment.start < to)
    .map((segment) => segment.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 6000);
}
