import { runAi } from "@/lib/ai/provider";
import { CHANNEL_KEYWORDS, TITLE_STYLE_EXAMPLES } from "@/lib/clipping/keywords";
import { formatClock, locateQuote } from "@/lib/story/story";
import type { Moment, OpenLoop, SectionRole, StoryCopy, StoryPlan, StorySection, TitleStyle, Unit } from "@/lib/story/types";

export const STORY_SYSTEM_PROMPT = `You are the story editor of a YouTube channel. You turn one long live stream into ONE 8 to 12 minute story-driven video (aim for 10) that people watch to the end.

Structure, in this order:
1. hook (0:00-0:30): the single most compelling line from ANYWHERE in the stream, used as a cold open. It may tease the payoff without giving it away.
2. setup: the problem and the stakes - why this day matters.
3. development: rising action, in one to three sections, with open loops (questions the viewer wants answered).
4. payoff: the key insight, result or reveal.
5. close: a wrap-up line and a natural call to action.

Rules:
- Only use moments you are given. Do not invent events.
- Cut chat-reading filler, waiting on builds, stream trouble, repeats and dead air.
- Within a section keep moments in the order they happened so the logic holds.
- Plant at least two open loops early and pay them off later.
- Quotes must be copied exactly from the moment text.

Return ONLY minified JSON:
{"hook":{"momentId":"m001","quote":"exact words","reason":"why this opens the video"},
"sections":[{"role":"setup|development|payoff|close","title":"2-6 word chapter title","momentIds":["m002"],"reason":"why"}],
"openLoops":[{"plantMomentId":"m002","plantQuote":"exact words","payoffMomentId":"m010","payoffQuote":"exact words","question":"the question the viewer is left holding"}]}`;

export function buildStoryPrompt(input: { title: string; targetSec: number; moments: Moment[]; runtimeOf: (id: string) => number }): string {
  const lines = input.moments.map((moment) => {
    const words = moment.text.split(/\s+/);
    const text = words.length > 110 ? `${words.slice(0, 110).join(" ")} ...` : moment.text;
    return `${moment.id} @${formatClock(moment.start)} (${Math.round(input.runtimeOf(moment.id))}s after cleanup, score ${moment.score}): ${text}`;
  });
  return [
    `Stream title: ${input.title}`,
    `Target runtime: ${Math.round(input.targetSec / 60)} minutes (between 8 and 12). Pick moments whose cleaned seconds add up to roughly that.`,
    "",
    "Moments (chronological):",
    ...lines
  ].join("\n");
}

type RawStory = {
  hook?: { momentId?: string; quote?: string; reason?: string };
  sections?: Array<{ role?: string; title?: string; momentIds?: string[]; reason?: string }>;
  openLoops?: Array<{ plantMomentId?: string; plantQuote?: string; payoffMomentId?: string; payoffQuote?: string; question?: string }>;
};

export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const ROLES = new Set<SectionRole>(["setup", "development", "payoff", "close"]);

export function parseStory(text: string, moments: Moment[], units: Map<string, Unit>, targetSec: number): StoryPlan | null {
  const raw = extractJson<RawStory>(text);
  if (!raw?.sections?.length) return null;
  const byId = new Map(moments.map((moment) => [moment.id, moment]));
  const unitsOf = (momentId?: string) => (byId.get(momentId ?? "")?.unitIds ?? []).map((id) => units.get(id)!).filter(Boolean);
  const seen = new Set<string>();
  const sections: StorySection[] = raw.sections
    .filter((section) => ROLES.has(section.role as SectionRole))
    .map((section) => ({
      role: section.role as SectionRole,
      title: (section.title ?? "").trim() || "Untitled",
      momentIds: (section.momentIds ?? []).filter((id) => byId.has(id) && !seen.has(id) && seen.add(id)),
      reason: (section.reason ?? "").trim()
    }))
    .filter((section) => section.momentIds.length > 0);
  if (sections.length === 0) return null;

  const hookUnits = raw.hook?.momentId ? locateQuote(raw.hook.quote ?? "", unitsOf(raw.hook.momentId)) : [];
  const openLoops: OpenLoop[] = (raw.openLoops ?? [])
    .map((loop) => {
      const plant = locateQuote(loop.plantQuote ?? "", unitsOf(loop.plantMomentId), 20)[0];
      const payoff = locateQuote(loop.payoffQuote ?? "", unitsOf(loop.payoffMomentId), 20)[0];
      return plant && payoff ? { plantUnitId: plant, payoffUnitId: payoff, question: (loop.question ?? "").trim() } : null;
    })
    .filter((loop): loop is OpenLoop => Boolean(loop));

  return {
    hookUnitIds: hookUnits,
    hookReason: (raw.hook?.reason ?? "").trim(),
    sections,
    openLoops,
    source: "ai",
    targetSec
  };
}

export async function askStory(input: {
  title: string;
  targetSec: number;
  moments: Moment[];
  units: Map<string, Unit>;
  runtimeOf: (id: string) => number;
}): Promise<StoryPlan | null> {
  const result = await runAi({
    maxTokens: 6000,
    system: STORY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildStoryPrompt(input) }]
  });
  if (!result || result.refused) return null;
  return parseStory(result.text, input.moments, input.units, input.targetSec);
}

export const COPY_SYSTEM_PROMPT = `You write YouTube packaging for a creator who builds software live on stream ("vibe coding" with AI agents) and documents the grind of moving out of his mom's basement.

You are given the FINAL sections of a 10 minute edit with the words actually spoken in each, plus the edited transcript. Everything you write must be true of THOSE words: do not describe anything that is not said in them, do not credit the creator with something a viewer or someone else made, and do not call something built when it was only asked for. Write:
- titles: exactly 5, each UNDER 60 characters, one per style: curiosity, outcome, contrarian, number, direct. Accurate to what the video actually shows - no clickbait it does not deliver.
- recommended: index 0-4 of the best title, and recommendedReason: one line.
- hookSentence: one or two sentences for the top of the description that mirror the video's cold open.
- arc: one short paragraph (3-4 sentences) telling the story arc - the problem and stakes, what the viewer will see, and that there is a payoff - WITHOUT spoiling the key reveal.
- takeaways: 3 to 5 short bullet lines.
- chapterTitles: an object mapping each chapter key given to a 2-6 word curiosity-driven, accurate title.
- hashtags: 3 to 5, and tags: 10-15 search tags from the key topics.
- thumbnails: exactly 3 concepts, each {emotion, frame, overlay, layout, colors}. overlay is 2-4 words and must NOT repeat words from any title. frame names the spoken moment to grab (quote a few words) and the expression to look for; do not invent props or actions.

Channel title style examples:
${TITLE_STYLE_EXAMPLES.join("\n")}
Channel keywords: ${CHANNEL_KEYWORDS.join(", ")}

Return ONLY minified JSON with keys: titles (array of {style,title}), recommended, recommendedReason, hookSentence, arc, takeaways, chapterTitles, hashtags, tags, thumbnails.`;

export function buildCopyPrompt(input: { title: string; outline: string; chapterKeys: Array<{ key: string; summary: string }>; transcript: string }): string {
  return [
    `Original stream title: ${input.title}`,
    "",
    "Story outline:",
    input.outline,
    "",
    "Chapter keys to title:",
    ...input.chapterKeys.map((chapter) => `${chapter.key}: ${chapter.summary}`),
    "",
    "Edited transcript:",
    input.transcript.slice(0, 24_000)
  ].join("\n");
}

const STYLES: TitleStyle[] = ["curiosity", "outcome", "contrarian", "number", "direct"];

export function parseCopy(text: string): StoryCopy | null {
  const raw = extractJson<Partial<StoryCopy> & { titles?: Array<{ style?: string; title?: string }> }>(text);
  if (!raw?.titles?.length) return null;
  const titles = raw.titles
    .map((option, index) => ({
      style: (STYLES.includes(option.style as TitleStyle) ? option.style : STYLES[index % STYLES.length]) as TitleStyle,
      title: (option.title ?? "").trim()
    }))
    .filter((option) => option.title)
    .slice(0, 5);
  return {
    titles,
    recommended: Math.min(titles.length - 1, Math.max(0, Number(raw.recommended) || 0)),
    recommendedReason: String(raw.recommendedReason ?? "").trim(),
    hookSentence: String(raw.hookSentence ?? "").trim(),
    arc: String(raw.arc ?? "").trim(),
    takeaways: (raw.takeaways ?? []).map(String).slice(0, 5),
    hashtags: (raw.hashtags ?? []).map(String).slice(0, 5),
    tags: (raw.tags ?? []).map(String).slice(0, 15),
    chapterTitles: (raw.chapterTitles ?? {}) as Record<string, string>,
    thumbnails: (raw.thumbnails ?? []).slice(0, 3).map((concept) => ({
      emotion: String(concept.emotion ?? ""),
      frame: String(concept.frame ?? ""),
      overlay: String(concept.overlay ?? ""),
      layout: String(concept.layout ?? ""),
      colors: String(concept.colors ?? "")
    }))
  };
}

export async function askCopy(input: Parameters<typeof buildCopyPrompt>[0]): Promise<StoryCopy | null> {
  const result = await runAi({
    maxTokens: 4000,
    system: COPY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildCopyPrompt(input) }]
  });
  if (!result || result.refused) return null;
  return parseCopy(result.text);
}
