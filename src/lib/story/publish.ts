import type { Chapter, EdlSegment, StoryCopy, StoryPlan, ThumbnailConcept, TitleOption } from "@/lib/story/types";
import type { TimelineWord } from "@/lib/story/edl";

export const MIN_CHAPTERS = 3;
export const MIN_CHAPTER_SEC = 10;
export const TITLE_MAX_CHARS = 60;
export const DRAFT_PREFIX = "[DRAFT] ";

export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rest).padStart(3, "0")}`;
}

export function buildSrt(words: TimelineWord[], maxWords = 8, maxSec = 3.2): string {
  const cues: Array<{ s: number; e: number; text: string }> = [];
  let current: TimelineWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    cues.push({ s: current[0].s, e: current[current.length - 1].e, text: current.map((word) => word.w).join(" ") });
    current = [];
  };
  for (const word of words) {
    const last = current[current.length - 1];
    if (current.length && (current.length >= maxWords || word.e - current[0].s > maxSec || word.s - last.e > 0.8)) flush();
    current.push(word);
    if (/[.!?]$/.test(word.w)) flush();
  }
  flush();
  return cues
    .map((cue, index) => {
      const end = Math.max(cue.e, cue.s + 0.3);
      const next = cues[index + 1];
      const safeEnd = next ? Math.min(end, next.s) : end;
      return `${index + 1}\n${srtTime(cue.s)} --> ${srtTime(safeEnd)}\n${cue.text}\n`;
    })
    .join("\n");
}

export function chapterClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function chaptersFromTimeline(
  segments: EdlSegment[],
  plan: StoryPlan,
  momentOfUnit: Map<string, string>,
  titleFor: (key: string, fallback: string) => string,
  runtimeSec: number
): Chapter[] {
  const raw: Chapter[] = [];
  let lastKey = "";
  const sectionIndex = new Map<string, number>();
  plan.sections.forEach((section, index) => section.momentIds.forEach((id) => sectionIndex.set(id, index)));
  for (const segment of segments) {
    if (!segment.enabled) continue;
    const isHook = raw.length === 0 && plan.hookUnitIds.includes(segment.unitId);
    const momentId = momentOfUnit.get(segment.unitId);
    const index = momentId !== undefined ? sectionIndex.get(momentId) : undefined;
    const key = isHook || index === undefined ? (raw.length === 0 ? "hook" : lastKey) : `s${index}`;
    if (key === lastKey) continue;
    const section = index !== undefined ? plan.sections[index] : undefined;
    raw.push({ seconds: segment.timelineIn, title: titleFor(key, key === "hook" ? "Cold open" : section?.title ?? "Next") });
    lastKey = key;
  }
  return normalizeChapters(raw, runtimeSec);
}

export function normalizeChapters(chapters: Chapter[], runtimeSec: number): Chapter[] {
  const sorted = [...chapters].sort((a, b) => a.seconds - b.seconds);
  const merged: Chapter[] = [];
  for (const chapter of sorted) {
    const seconds = merged.length === 0 ? 0 : Math.floor(chapter.seconds);
    const previous = merged[merged.length - 1];
    if (previous && seconds - previous.seconds < MIN_CHAPTER_SEC) continue;
    if (previous && previous.title === chapter.title) continue;
    merged.push({ seconds, title: chapter.title });
  }
  while (merged.length > 1 && runtimeSec - merged[merged.length - 1].seconds < MIN_CHAPTER_SEC) merged.pop();
  return merged;
}

export type ChapterCheck = { ok: boolean; problems: string[] };

export function validateChapters(chapters: Chapter[], runtimeSec: number): ChapterCheck {
  const problems: string[] = [];
  if (chapters.length < MIN_CHAPTERS) problems.push(`needs at least ${MIN_CHAPTERS} chapters, has ${chapters.length}`);
  if (chapters[0]?.seconds !== 0) problems.push("first chapter must start at 00:00");
  chapters.forEach((chapter, index) => {
    const end = chapters[index + 1]?.seconds ?? runtimeSec;
    if (index > 0 && chapter.seconds <= chapters[index - 1].seconds) problems.push(`chapter ${index + 1} is out of order`);
    if (end - chapter.seconds < MIN_CHAPTER_SEC) problems.push(`chapter ${index + 1} is under ${MIN_CHAPTER_SEC}s`);
    const words = chapter.title.trim().split(/\s+/).length;
    if (words < 2 || words > 6) problems.push(`chapter ${index + 1} title should be 2 to 6 words`);
  });
  return { ok: problems.length === 0, problems };
}

export function chapterBlock(chapters: Chapter[]): string {
  return chapters.map((chapter) => `${chapterClock(chapter.seconds)} ${chapter.title}`).join("\n");
}

export function buildDescription(copy: StoryCopy, chapters: Chapter[]): string {
  const hashtags = copy.hashtags.slice(0, 5).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`).replace(/\s+/g, ""));
  return [
    copy.hookSentence.trim(),
    "",
    copy.arc.trim(),
    "",
    "Chapters",
    chapterBlock(chapters),
    "",
    "Key takeaways",
    ...copy.takeaways.slice(0, 5).map((line) => `- ${line.trim()}`),
    "",
    "If this helped, subscribe - I build in public every day until I can move out of my mom's basement.",
    "",
    "Links",
    "- Website: [ADD LINK]",
    "- Discord: [ADD LINK]",
    "- X / Twitter: [ADD LINK]",
    "- Instagram / TikTok: [ADD LINK]",
    "",
    hashtags.join(" ")
  ].join("\n");
}

export function validateTitles(titles: TitleOption[]): string[] {
  const problems: string[] = [];
  if (titles.length !== 5) problems.push(`needs 5 titles, has ${titles.length}`);
  const styles = new Set(titles.map((title) => title.style));
  if (styles.size < Math.min(5, titles.length)) problems.push("titles should each use a different style");
  titles.forEach((title, index) => {
    if (title.title.length >= TITLE_MAX_CHARS) problems.push(`title ${index + 1} is ${title.title.length} characters`);
  });
  return problems;
}

export function draftTitle(title: string): string {
  return `${DRAFT_PREFIX}${title}`.slice(0, 100);
}

export function titlesMarkdown(copy: StoryCopy): string {
  return [
    "# Title options",
    "",
    ...copy.titles.map(
      (option, index) => `${index + 1}. **${option.title}** (${option.style}, ${option.title.length} chars)${index === copy.recommended ? " - recommended" : ""}`
    ),
    "",
    `Recommended: **${copy.titles[copy.recommended]?.title ?? ""}** - ${copy.recommendedReason}`,
    ""
  ].join("\n");
}

export function thumbnailsMarkdown(concepts: ThumbnailConcept[], frames: Array<{ file: string; seconds: number; reason: string }>): string {
  return [
    "# Thumbnail concepts",
    "",
    ...concepts.flatMap((concept, index) => [
      `## Concept ${index + 1}`,
      "",
      `- Emotion / expression: ${concept.emotion}`,
      `- Frame: ${concept.frame}`,
      `- Overlay text: "${concept.overlay}"`,
      `- Layout: ${concept.layout}`,
      `- Colour contrast: ${concept.colors}`,
      ""
    ]),
    "# Candidate frames",
    "",
    ...frames.map((frame) => `- \`thumbnail-frames/${frame.file}\` at ${chapterClock(frame.seconds)} of the source - ${frame.reason}`),
    ""
  ].join("\n");
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

export function hookCaptionsAss(words: TimelineWord[], width: number, height: number, wordsPerLine = 3): string {
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Hook,Arial Black,${Math.round(height * 0.085)},&H0000E5FF,&H0000E5FF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,${Math.round(height * 0.007)},${Math.round(height * 0.003)},2,80,80,${Math.round(height * 0.14)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    const chunk = words.slice(i, i + wordsPerLine);
    const next = words[i + wordsPerLine];
    const end = next ? Math.min(next.s, chunk[chunk.length - 1].e + 0.35) : chunk[chunk.length - 1].e + 0.35;
    const text = chunk
      .map((word) => word.w.replace(/[{}\\]/g, "").toUpperCase())
      .join(" ")
      .replace(/\s+-\s*/g, " ");
    lines.push(`Dialogue: 0,${assTime(chunk[0].s)},${assTime(Math.max(end, chunk[0].s + 0.25))},Hook,,0,0,0,,{\\fad(40,40)}${text}`);
  }
  return `${lines.join("\n")}\n`;
}
