import { aiConfigured, runAi } from "@/lib/ai";
import { CHANNEL_KEYWORDS, TITLE_STYLE_EXAMPLES } from "@/lib/clipping/keywords";
import type { LongformProject, LongformSegment } from "@/lib/longform/types";
import type { CaptionSegment } from "@/types/domain";

/**
 * Publish-ready metadata for a long-form upload: several title options, a
 * full YouTube description (hook line, summary, chapters, CTA, hashtags) and
 * bare tags for the YouTube tags box.
 *
 * Follows the channel convention from clipping/titles.ts: metadata is written
 * by Claude against the channel's keyword set and title style guide — never
 * sliced out of the transcript — and degrades to a keyword-driven offline
 * fallback when no API key is configured, so the button always produces
 * something usable.
 */

export type LongformChapter = {
  /** MM:SS (or H:MM:SS) into the EDITED runtime. */
  time: string;
  label: string;
};

export type LongformVideoMetadata = {
  /** Title options, strongest first. */
  titles: string[];
  /** Ready-to-paste YouTube description. */
  description: string;
  /** Bare keywords (no #) for YouTube's tags box. */
  tags: string[];
  chapters: LongformChapter[];
  source: "ai" | "fallback";
  generatedAt: string;
};

const TITLE_OPTIONS = 5;
const MAX_TITLE_CHARS = 95;
const MAX_TAGS = 18;
const MAX_TRANSCRIPT_CHARS = 9000;

export function longformMetadataConfigured() {
  return aiConfigured();
}

export function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Maps a source-timeline second onto the edited runtime by subtracting the
 * disabled (cut) spans before it. Approximate — it ignores the hook window
 * being pulled to the front, which is almost always the opening seconds
 * anyway — but plenty accurate for chapter markers.
 */
export function toEditedSeconds(sourceSec: number, segments: LongformSegment[]): number {
  let cut = 0;
  for (const segment of segments) {
    if (segment.enabled) continue;
    if (segment.end <= sourceSec) cut += segment.end - segment.start;
    else if (segment.start < sourceSec) cut += sourceSec - segment.start;
  }
  return Math.max(0, sourceSec - cut);
}

/**
 * Timestamped transcript lines in edited-runtime minutes, capped so a long
 * recording still fits one prompt. Groups caption segments into ~30s lines.
 */
export function transcriptLines(transcript: CaptionSegment[], segments: LongformSegment[]): string {
  const lines: string[] = [];
  let bucketStart = -1;
  let bucketText: string[] = [];
  for (const segment of transcript) {
    const edited = toEditedSeconds(segment.start, segments);
    if (bucketStart === -1) bucketStart = edited;
    bucketText.push(segment.text.trim());
    if (edited - bucketStart >= 30) {
      lines.push(`[${formatChapterTime(bucketStart)}] ${bucketText.join(" ")}`);
      bucketStart = -1;
      bucketText = [];
    }
  }
  if (bucketText.length) lines.push(`[${formatChapterTime(Math.max(0, bucketStart))}] ${bucketText.join(" ")}`);
  return lines.join("\n").slice(0, MAX_TRANSCRIPT_CHARS);
}

export const LONGFORM_METADATA_SYSTEM_PROMPT = `You are a YouTube growth strategist who writes titles and descriptions for long-form videos.

Channel context: the creator live-streams and records himself building CoLateral (an AI-powered workspace for structural engineers) using AI coding tools, and shares what he learns about AI, business and engineering. Recurring keywords to work in whenever the video genuinely supports them: ${CHANNEL_KEYWORDS.join(", ")}.

Title rules — every title must:
- Be a complete, grammatical phrase — NEVER a transcript fragment.
- Be under ${MAX_TITLE_CHARS} characters, in Title Case.
- Lead with curiosity, stakes, or a bold claim; numbers and How/Why/What openers work well.
- Use the channel keywords naturally when they fit — never force one that doesn't.
- Contain no quotation marks, hashtags, or emoji.

Examples of the exact title style to match:
${TITLE_STYLE_EXAMPLES.map((t) => `- ${t}`).join("\n")}

Description rules:
- Open with 1-2 hook sentences that would make someone click "more" (the first 120 characters show in search).
- Then a short paragraph on what the video covers and why it matters, weaving in the channel keywords naturally.
- Then 3-5 bullet lines ("- ") of the concrete things covered.
- Close with a one-line call to action to subscribe for more AI/vibe-coding/building-in-public content, then 3-5 hashtags on the final line.
- No invented facts, links, or timestamps you were not given.

You always return strict JSON.`;

/** Builds the user prompt. Pure, for tests. */
export function buildLongformMetadataPrompt(input: {
  name: string;
  durationSec: number;
  transcriptText: string;
  wantChapters: boolean;
}): string {
  const minutes = Math.max(1, Math.round(input.durationSec / 60));
  const lines = [
    `Video: "${input.name}" — about ${minutes} minute${minutes === 1 ? "" : "s"} long after editing.`,
    "",
    input.transcriptText
      ? `Timestamped transcript (times are into the edited video):\n${input.transcriptText}`
      : "(No transcript is available — work from the video name and channel context.)",
    "",
    `Write publish-ready YouTube metadata:`,
    `1. "titles": exactly ${TITLE_OPTIONS} distinct title options following the title rules, strongest first.`,
    `2. "description": the full description following the description rules.`,
    `3. "tags": ${MAX_TAGS} bare keyword tags (no #) mixing the channel keywords with specific topics from this video, most important first.`
  ];
  if (input.wantChapters) {
    lines.push(
      `4. "chapters": 4-8 chapters covering the whole runtime as {"time": "M:SS", "label": "..."}. The first must be at "0:00". Use ONLY timestamps that appear in the transcript. Labels are 2-5 words, no punctuation.`
    );
  }
  lines.push(
    "",
    `Respond with ONLY valid JSON: {"titles": [...], "description": "...", "tags": [...]${input.wantChapters ? ', "chapters": [...]' : ""}}`
  );
  return lines.join("\n");
}

function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/#[\w-]+/g, " ")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.split(/\s+/).length < 3 || cleaned.length > MAX_TITLE_CHARS + 10) return "";
  return cleaned;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const tag = entry.replace(/^#+/, "").replace(/\s+/g, " ").trim();
    if (!tag || tag.length > 60) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function normalizeChapters(raw: unknown): LongformChapter[] {
  if (!Array.isArray(raw)) return [];
  const out: LongformChapter[] = [];
  for (const entry of raw) {
    const time = typeof (entry as { time?: unknown })?.time === "string" ? (entry as { time: string }).time.trim() : "";
    const label = typeof (entry as { label?: unknown })?.label === "string" ? (entry as { label: string }).label.trim() : "";
    if (!/^\d+:\d{2}(:\d{2})?$/.test(time) || !label) continue;
    out.push({ time, label });
  }
  return out.slice(0, 10);
}

/** Pulls the metadata object out of the model's reply, tolerating fences/prose. */
export function parseLongformMetadata(text: string): Omit<LongformVideoMetadata, "source" | "generatedAt"> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    const titles = Array.isArray(parsed.titles)
      ? parsed.titles
          .filter((t): t is string => typeof t === "string")
          .map(cleanTitle)
          .filter(Boolean)
          .slice(0, TITLE_OPTIONS)
      : [];
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    if (titles.length === 0 || !description) return null;
    return {
      titles,
      description,
      tags: normalizeTags(parsed.tags),
      chapters: normalizeChapters(parsed.chapters)
    };
  } catch {
    return null;
  }
}

/** Offline fallback: keyword-driven, honest, and clearly editable. */
export function fallbackLongformMetadata(project: Pick<LongformProject, "name">): LongformVideoMetadata {
  const base = project.name.trim() || "New Video";
  return {
    titles: [
      base,
      `How I Built ${base} With AI`,
      `${base} — Building in Public`,
      `What I Learned Making ${base}`,
      `${base} (Full Walkthrough)`
    ].map((t) => (t.length > MAX_TITLE_CHARS ? `${t.slice(0, MAX_TITLE_CHARS - 1)}…` : t)),
    description: [
      `${base} — building in public with AI.`,
      "",
      `In this video I keep building CoLateral, my AI-powered workspace for structural engineers, using AI coding tools like Claude. Expect real ${CHANNEL_KEYWORDS.slice(0, 4).join(", ")} work — wins, mistakes, and everything in between.`,
      "",
      "Subscribe for more AI, vibe coding and building-in-public videos.",
      "",
      "#AI #VibeCoding #BuildingInPublic"
    ].join("\n"),
    tags: [...CHANNEL_KEYWORDS],
    chapters: [],
    source: "fallback",
    generatedAt: new Date().toISOString()
  };
}

/** Renders chapters into the "0:00 Label" lines YouTube parses. */
export function chapterBlock(chapters: LongformChapter[]): string {
  if (chapters.length === 0) return "";
  return `\n\nChapters:\n${chapters.map((chapter) => `${chapter.time} ${chapter.label}`).join("\n")}`;
}

/**
 * Generates publish-ready metadata for a long-form project in one Claude
 * call. Never throws — returns the offline fallback on any failure.
 */
export async function generateLongformMetadata(project: LongformProject): Promise<LongformVideoMetadata> {
  const fallback = fallbackLongformMetadata(project);
  if (!longformMetadataConfigured()) return fallback;

  // Only ask for chapters when the transcript actually covers the video —
  // long recordings only get their opening minutes transcribed.
  const transcriptEnd = project.transcript.length ? project.transcript[project.transcript.length - 1].end : 0;
  const wantChapters = project.transcript.length > 0 && transcriptEnd >= project.durationSec * 0.8;
  const transcriptText = transcriptLines(project.transcript, project.segments);

  try {
    const result = await runAi({
      maxTokens: 2500,
      system: LONGFORM_METADATA_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildLongformMetadataPrompt({
            name: project.name,
            durationSec: project.durationSec,
            transcriptText,
            wantChapters
          })
        }
      ]
    });
    if (!result || result.refused) return fallback;
    const parsed = parseLongformMetadata(result.text);
    if (!parsed) return fallback;
    const chapters = wantChapters ? parsed.chapters : [];
    return {
      ...parsed,
      chapters,
      description: `${parsed.description}${chapterBlock(chapters)}`,
      source: "ai",
      generatedAt: new Date().toISOString()
    };
  } catch {
    return fallback;
  }
}
