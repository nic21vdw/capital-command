import { aiConfigured, runAi } from "@/lib/ai";
import { CHANNEL_CONTEXT, CHANNEL_KEYWORDS } from "@/lib/clipping/keywords";
import { analyzeTranscript, densityScore } from "@/lib/clipping/text-signals";
import { HOOK_PASS_SCORE, transcriptSentences } from "@/lib/longform/hook-review";
import { MIN_LONGFORM_SEC, formatChapterTime } from "@/lib/longform/length";
import { hookCaptions, planHookEnd, sourceTimeToOutput, type KeptRange } from "@/lib/longform/plan";
import { contentTerms, fallbackTopicTitle } from "@/lib/longform/topics";
import type {
  LongformHighlight,
  LongformHighlightPassage,
  LongformHook,
  LongformSegment
} from "@/lib/longform/types";
import type { CaptionSegment } from "@/types/domain";

// ----- The best-of edit -----
// A stream is hours long and the upload people actually watch is twenty
// minutes. Cutting the dead space out of a three-hour stream still leaves a
// two-hour video, and topic segments carve it into several videos rather than
// one. The best-of edit is the third answer, the one a human editor gives:
// read the whole stream, keep the passages that carry it, drop the setup, the
// tech trouble and the repeats, open on the strongest line, and put chapters
// on what is left.
//
// Everything here is pure except `buildHighlight`, which makes one model call
// and falls back to the offline scorer when there is no key or the reply is
// unusable. Applying the result is just segments and a hook, so the export
// engine renders it with no special case.

/** A pause this long between two sentences ends a passage on its own. */
const PAUSE_BREAK_SEC = 2.5;
/** A continuous run of passages reads better than hopping between them. */
const CONTINUITY_BONUS = 6;
/** Neighbouring passages this close together count as one continuous run. */
const CONTINUITY_GAP_SEC = 15;
/** A chapter shorter than this merges into the one before it. */
const MIN_CHAPTER_SEC = 75;
/** YouTube ignores a chapter list with any chapter under ten seconds. */
const YOUTUBE_MIN_CHAPTER_SEC = 10;
/** YouTube needs at least three chapters before it shows any. */
const YOUTUBE_MIN_CHAPTERS = 3;
const MAX_CHAPTERS = 12;
/** A cold open is one or two lines, not a second intro. */
const COLD_OPEN_MIN_SEC = 8;
const COLD_OPEN_MAX_SEC = 20;
/** How much a lifted line has to beat the natural opening by to replace it. */
const COLD_OPEN_MARGIN = 8;
const SENTENCE_END = /[.!?]["')\]]?$/;

export const HIGHLIGHT_TARGETS = [
  { id: "tight", label: "12 min", sec: 12 * 60 },
  { id: "standard", label: "20 min", sec: 20 * 60 },
  { id: "deep", label: "30 min", sec: 30 * 60 }
] as const;

export const DEFAULT_HIGHLIGHT_OPTIONS = {
  /** The runtime the edit aims for. Twenty minutes: long enough to be a real video, short enough to finish. */
  targetSec: 20 * 60,
  /** Shortest passage worth keeping; anything shorter is a moment, and moments belong to the Clip Generator. */
  minPassageSec: 40,
  /** Where a passage looks for a sentence end to stop on. */
  idealPassageSec: 110,
  /** Longest a passage runs before it is closed regardless. */
  maxPassageSec: 240,
  /** A silence this long always ends a passage: the stream stopped. */
  deadGapSec: 12,
  /** Below this delivery rate a stretch is mostly waiting, and its score is halved. */
  minWordsPerSec: 1
};

export type HighlightOptions = typeof DEFAULT_HIGHLIGHT_OPTIONS;

export type PlannedPassage = {
  start: number;
  end: number;
  text: string;
  opening: string;
  keywords: string[];
  score: number;
};

type Sentence = { text: string; start: number; end: number };

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function spokenText(transcript: CaptionSegment[], start: number, end: number): string {
  return transcript
    .filter((segment) => segment.start >= start - 0.001 && segment.start < end && segment.text.trim())
    .map((segment) => segment.text.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Groups the whole transcript into passages: runs of complete sentences that
 * close on a sentence end once they are long enough, on a real pause, or at
 * the length cap. A passage never spans a dead stretch, and one too short to
 * stand on its own is folded into the passage before it or dropped.
 */
export function buildPassageWindows(
  transcript: CaptionSegment[],
  options: Partial<HighlightOptions> = {}
): KeptRange[] {
  const { minPassageSec, idealPassageSec, maxPassageSec, deadGapSec } = { ...DEFAULT_HIGHLIGHT_OPTIONS, ...options };
  const sentences = transcriptSentences(transcript, Number.POSITIVE_INFINITY);
  const windows: KeptRange[] = [];
  let group: Sentence[] = [];
  const close = () => {
    if (group.length === 0) return;
    windows.push({ start: group[0].start, end: group[group.length - 1].end });
    group = [];
  };
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const previous = group[group.length - 1];
    if (previous && sentence.start - previous.end >= deadGapSec) close();
    group.push(sentence);
    const length = sentence.end - group[0].start;
    const next = sentences[index + 1];
    const gap = next ? next.start - sentence.end : Number.POSITIVE_INFINITY;
    const endsThought = SENTENCE_END.test(sentence.text.trim());
    if (
      length >= maxPassageSec ||
      (endsThought && length >= idealPassageSec) ||
      (endsThought && gap >= PAUSE_BREAK_SEC && length >= minPassageSec)
    ) {
      close();
    }
  }
  close();

  // A stub too short to stand is part of the thought before it when the two
  // are continuous, and a fragment worth nothing when they are not.
  const merged: KeptRange[] = [];
  for (const window of windows) {
    const length = window.end - window.start;
    const last = merged[merged.length - 1];
    if (length < minPassageSec) {
      if (last && window.start - last.end < deadGapSec && window.end - last.start <= maxPassageSec * 1.25) {
        last.end = window.end;
      }
      continue;
    }
    merged.push({ ...window });
  }
  return merged.map((window) => ({ start: round3(window.start), end: round3(window.end) }));
}

/**
 * How much a passage carries, 0-100. Delivery density leads (a stretch of
 * waiting on a build is the first thing an editor cuts), then energy, then
 * whether it stands on its own and opens on something, then whether it is
 * about what the channel is about.
 */
export function scorePassage(
  transcript: CaptionSegment[],
  start: number,
  end: number,
  options: Partial<HighlightOptions> = {}
): number {
  const { minWordsPerSec } = { ...DEFAULT_HIGHLIGHT_OPTIONS, ...options };
  const signals = analyzeTranscript(transcript, start, end + 0.001);
  if (!signals.hasText) return 0;
  const lower = spokenText(transcript, start, end).toLowerCase();
  const channelHits = CHANNEL_KEYWORDS.filter((keyword) => lower.includes(keyword.toLowerCase())).length;
  const channel = clamp(channelHits / 3, 0, 1) * 100;
  let score =
    densityScore(signals.wordsPerSecond) * 0.35 +
    signals.intensity * 0.25 +
    signals.standalone * 0.15 +
    signals.hook * 0.15 +
    channel * 0.1;
  if (signals.wordsPerSecond < minWordsPerSec) score *= 0.5;
  return Math.round(clamp(score, 0, 100));
}

/** Terms each passage uses more than the stream as a whole does. */
function passageKeywords(texts: string[], limit = 4): string[][] {
  const documentFrequency = new Map<string, number>();
  const bags = texts.map((text) => {
    const counts = new Map<string, number>();
    for (const term of contentTerms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    return counts;
  });
  return bags.map((counts) =>
    [...counts.entries()]
      .map(([term, count]) => ({
        term,
        weight: count * Math.log(1 + texts.length / Math.max(1, documentFrequency.get(term) ?? 1))
      }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
      .slice(0, limit)
      .map((entry) => entry.term)
  );
}

/** Every candidate passage of the stream, scored, in source order. */
export function planPassages(
  transcript: CaptionSegment[],
  options: Partial<HighlightOptions> = {}
): PlannedPassage[] {
  const windows = buildPassageWindows(transcript, options);
  const texts = windows.map((window) => spokenText(transcript, window.start, window.end));
  const keywords = passageKeywords(texts);
  return windows
    .map((window, index) => ({
      start: window.start,
      end: window.end,
      text: texts[index],
      opening: texts[index].split(/\s+/).slice(0, 14).join(" "),
      keywords: keywords[index],
      score: scorePassage(transcript, window.start, window.end, options)
    }))
    .filter((passage) => passage.text.length > 0);
}

/** Seconds of a source window that survive the cut plan. */
export function keptSecondsIn(segments: LongformSegment[], start: number, end: number): number {
  let kept = 0;
  for (const segment of segments) {
    if (!segment.enabled) continue;
    const overlap = Math.min(end, segment.end) - Math.max(start, segment.start);
    if (overlap > 0) kept += overlap;
  }
  return round3(kept);
}

/**
 * Picks passages until the edit reaches its target runtime. Highest score
 * first, with a bonus for a passage that continues one already picked, so the
 * edit plays as a few continuous runs instead of a montage. Never goes more
 * than a tenth over the target, and a stream with less good material than the
 * target keeps all of it.
 */
export function selectPassages(
  passages: Array<Pick<PlannedPassage, "start" | "end" | "score">>,
  runtimes: number[],
  targetSec: number
): Set<number> {
  const chosen = new Set<number>();
  const total = runtimes.reduce((sum, value) => sum + value, 0);
  if (total <= targetSec) {
    passages.forEach((passage, index) => {
      if (runtimes[index] > 0 && passage.score > 0) chosen.add(index);
    });
    return chosen;
  }
  const continues = (index: number) =>
    (chosen.has(index - 1) && passages[index].start - passages[index - 1].end < CONTINUITY_GAP_SEC) ||
    (chosen.has(index + 1) && passages[index + 1].start - passages[index].end < CONTINUITY_GAP_SEC);
  const ceiling = targetSec * 1.1;
  let runtime = 0;
  while (runtime < targetSec * 0.97) {
    let best = -1;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < passages.length; index += 1) {
      if (chosen.has(index) || runtimes[index] <= 0 || passages[index].score <= 0) continue;
      if (runtime + runtimes[index] > ceiling) continue;
      const value = passages[index].score + (continues(index) ? CONTINUITY_BONUS : 0);
      if (value > bestValue) {
        bestValue = value;
        best = index;
      }
    }
    if (best === -1) break;
    chosen.add(best);
    runtime += runtimes[best];
  }
  return chosen;
}

/** Merges overlapping or touching windows into sorted, disjoint ones. */
function mergeWindows(windows: KeptRange[]): KeptRange[] {
  const sorted = [...windows].filter((window) => window.end > window.start).sort((a, b) => a.start - b.start);
  const out: KeptRange[] = [];
  for (const window of sorted) {
    const last = out[out.length - 1];
    if (last && window.start <= last.end + 0.002) last.end = Math.max(last.end, window.end);
    else out.push({ ...window });
  }
  return out;
}

/**
 * The cut plan restricted to the chosen windows: inside a window every
 * segment keeps its own keep/cut state (the dead space inside a passage is
 * still cut), and everything outside every window is cut. Segments that
 * straddle a window edge are split there.
 */
export function restrictSegments(segments: LongformSegment[], windows: KeptRange[]): LongformSegment[] {
  const merged = mergeWindows(windows);
  const out: LongformSegment[] = [];
  const push = (segment: LongformSegment, start: number, end: number, enabled: boolean) => {
    if (end - start < 0.05) return;
    out.push({ ...segment, start: round3(start), end: round3(end), enabled });
  };
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    let cursor = segment.start;
    for (const window of merged) {
      if (window.end <= cursor || window.start >= segment.end) continue;
      if (window.start > cursor) push(segment, cursor, window.start, false);
      const insideEnd = Math.min(segment.end, window.end);
      push(segment, Math.max(cursor, window.start), insideEnd, segment.enabled);
      cursor = insideEnd;
    }
    if (cursor < segment.end) push(segment, cursor, segment.end, false);
  }
  return out.map((segment, index) => ({ ...segment, id: `seg-${index + 1}` }));
}

function openingStrength(transcript: CaptionSegment[], start: number, end: number): number {
  const signals = analyzeTranscript(transcript, start, end + 0.001);
  if (!signals.hasText) return 0;
  return Math.round(signals.hook * 0.6 + signals.standalone * 0.2 + densityScore(signals.wordsPerSecond) * 0.2);
}

/**
 * The line the video opens on. The strongest complete sentence anywhere in
 * the edit, extended by the lines after it to a proper beat of eight to twenty
 * seconds. Returns undefined when nothing beats the first passage's own
 * opening by a clear margin, because a natural start that already grabs is
 * better than a lifted one.
 */
export function pickColdOpen(
  transcript: CaptionSegment[],
  windows: KeptRange[]
): LongformHighlight["coldOpen"] | undefined {
  const merged = mergeWindows(windows);
  if (merged.length === 0) return undefined;
  const first = merged[0];
  const natural = openingStrength(transcript, first.start, Math.min(first.end, first.start + 30));
  const sentences = transcriptSentences(transcript, Number.POSITIVE_INFINITY);
  const inside = (sentence: Sentence) =>
    merged.find((window) => sentence.start >= window.start - 0.001 && sentence.end <= window.end + 0.001);

  let best: { index: number; score: number; window: KeptRange } | undefined;
  sentences.forEach((sentence, index) => {
    const window = inside(sentence);
    if (!window) return;
    // The first half-minute of the edit is the natural opening already.
    if (window === first && sentence.start < first.start + 30) return;
    if (sentence.end - sentence.start < 1.5 || sentence.end - sentence.start > COLD_OPEN_MAX_SEC) return;
    const signals = analyzeTranscript(transcript, sentence.start, sentence.end + 0.001);
    if (!signals.hasText) return;
    const score = Math.round(
      signals.hook * 0.5 + signals.standalone * 0.2 + signals.intensity * 0.15 + densityScore(signals.wordsPerSecond) * 0.15
    );
    if (!best || score > best.score) best = { index, score, window };
  });
  if (!best || best.score < Math.max(HOOK_PASS_SCORE, natural + COLD_OPEN_MARGIN)) return undefined;

  const opening = sentences[best.index];
  let end = opening.end;
  const texts = [opening.text];
  for (let index = best.index + 1; index < sentences.length && end - opening.start < COLD_OPEN_MIN_SEC; index += 1) {
    const next = sentences[index];
    if (next.end > best.window.end + 0.001 || next.end - opening.start > COLD_OPEN_MAX_SEC) break;
    end = next.end;
    texts.push(next.text);
  }
  return { text: texts.join(" "), start: round3(opening.start), end: round3(end), score: best.score };
}

/**
 * The hook for the best-of edit: the project's own hook look (zoom, focus,
 * caption style) over the cold-open line, or over the first passage's opening
 * when no lifted line beats it. Captions are cut from the whole-stream
 * transcript, because the cold open is usually hours past what the project
 * itself transcribed.
 */
export function highlightHook(
  base: LongformHook,
  transcript: CaptionSegment[],
  windows: KeptRange[],
  coldOpen: LongformHighlight["coldOpen"] | undefined
): LongformHook {
  const merged = mergeWindows(windows);
  const first = merged[0];
  const start = coldOpen ? coldOpen.start : first ? first.start : base.start;
  // The natural opening is the usual thirty-second block, landed on a
  // completed thought and kept inside the first passage.
  const end = coldOpen ? coldOpen.end : first ? planHookEnd(transcript, first.end, first.start) : base.end;
  return {
    ...base,
    enabled: true,
    start: round3(start),
    end: round3(end),
    captions: hookCaptions(transcript, start, end)
  };
}

export type HighlightChapter = { time: string; label: string; seconds: number };

/**
 * Chapters for the edit, timed on the EDITED runtime. Each run of enabled
 * passages under one label is a chapter; a chapter that would run under a
 * minute and a bit plays under the one before it instead. The first chapter is always 0:00 (the cold open plays under it),
 * and the list follows YouTube's rules or is empty: at least three chapters,
 * none under ten seconds.
 */
export function highlightChapters(
  passages: Array<Pick<LongformHighlightPassage, "start" | "end" | "label" | "enabled">>,
  segments: LongformSegment[],
  hook: LongformHook
): HighlightChapter[] {
  const enabled = passages.filter((passage) => passage.enabled).sort((a, b) => a.start - b.start);
  const groups: Array<{ label: string; seconds: number; endSeconds: number }> = [];
  for (const passage of enabled) {
    const seconds = sourceTimeToOutput(passage.start, segments, hook);
    const endSeconds = sourceTimeToOutput(passage.end, segments, hook);
    if (seconds === null || endSeconds === null) continue;
    const last = groups[groups.length - 1];
    if (last && passage.label === last.label) {
      last.endSeconds = Math.max(last.endSeconds, endSeconds);
      continue;
    }
    groups.push({ label: passage.label.trim() || `Part ${groups.length + 1}`, seconds, endSeconds });
  }
  if (groups.length === 0) return [];
  groups.sort((a, b) => a.seconds - b.seconds);
  // The cold open plays before the first passage, under the first chapter.
  groups[0].seconds = 0;

  const span = (index: number) =>
    (index + 1 < groups.length ? groups[index + 1].seconds : groups[index].endSeconds) - groups[index].seconds;
  const shortestAfterFirst = () => {
    let shortest = 1;
    for (let index = 2; index < groups.length; index += 1) if (span(index) < span(shortest)) shortest = index;
    return shortest;
  };
  // An aside too short to be a chapter plays under the one before it, and too
  // many chapters is a table of contents nobody reads: fold the shortest into
  // its predecessor until neither is true.
  while (groups.length > 1) {
    const shortest = shortestAfterFirst();
    if (span(shortest) >= MIN_CHAPTER_SEC && groups.length <= MAX_CHAPTERS) break;
    groups.splice(shortest, 1);
  }

  const chapters = groups.filter(
    (group, index) => index === 0 || group.seconds - groups[index - 1].seconds >= YOUTUBE_MIN_CHAPTER_SEC
  );
  if (chapters.length < YOUTUBE_MIN_CHAPTERS) return [];
  return chapters.map((group) => ({
    time: formatChapterTime(group.seconds),
    label: group.label,
    seconds: round3(group.seconds)
  }));
}

// ----- The editor pass -----

const MAX_PASSAGE_EXCERPT_CHARS = 420;
const MAX_LABEL_CHARS = 48;

export const HIGHLIGHT_SYSTEM_PROMPT = `You are the editor of a YouTube channel. You turn one long live stream into ONE tight long-form upload that people finish.

Channel context: ${CHANNEL_CONTEXT} Recurring keywords: ${CHANNEL_KEYWORDS.join(", ")}.

You are given the stream as numbered passages in the order they happened, each with its runtime after dead space is cut and an automatic score. Decide what the upload keeps.

How to edit:
- Keep the passages that carry the story: the goal being set, real progress, problems and how they were solved, results, strong opinions and insights.
- Cut setup and housekeeping, waiting on builds or installs, technical trouble with the stream itself, reading chat or greeting viewers, repeated explanations, and anything that only makes sense live.
- The upload plays in the order things happened. Prefer continuous runs of passages over isolated ones, so each part has its context.
- Keep the total runtime of the kept passages close to the target.
- Choose the single passage holding the strongest line to open the video on as a cold open.
- Write a chapter label for every kept passage: 2-5 words, Title Case, saying what happens there, no punctuation or emoji. Consecutive passages about the same thing share one label.

You always return strict JSON.`;

export type HighlightRequestPassage = {
  id: string;
  /** Minutes into the stream, for the model's sense of the arc. */
  at: string;
  runtimeSec: number;
  score: number;
  text: string;
};

/** Builds the editor-pass prompt. Pure, for tests. */
export function buildHighlightPrompt(input: {
  streamName: string;
  targetSec: number;
  passages: HighlightRequestPassage[];
}): string {
  const lines = [
    `Stream: ${input.streamName.trim() || "Untitled stream"}`,
    `Target runtime: about ${Math.round(input.targetSec / 60)} minutes (${Math.round(input.targetSec)} seconds) of kept passages.`,
    "",
    'Return ONLY JSON: {"keep": ["<passage id>", ...], "coldOpen": "<passage id>", "labels": {"<passage id>": "<chapter label>", ...}}',
    "",
    "Passages:"
  ];
  for (const passage of input.passages) {
    lines.push(
      `[${passage.id}] at ${passage.at}, ${Math.round(passage.runtimeSec)}s, score ${passage.score}: ${passage.text
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_PASSAGE_EXCERPT_CHARS)}`
    );
  }
  return lines.join("\n");
}

function cleanLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/["'“”#:|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).length;
  if (words < 1 || words > 7 || cleaned.length > MAX_LABEL_CHARS) return "";
  return cleaned;
}

export type HighlightDecision = {
  keep: string[];
  coldOpen?: string;
  labels: Map<string, string>;
};

/** Pulls the editor's decision out of the model's reply, tolerating fences and prose. */
export function parseHighlightDecision(text: string, knownIds: Set<string>): HighlightDecision | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    const keep = Array.isArray(parsed.keep)
      ? [...new Set(parsed.keep.filter((id): id is string => typeof id === "string" && knownIds.has(id)))]
      : [];
    if (keep.length === 0) return null;
    const labels = new Map<string, string>();
    if (parsed.labels && typeof parsed.labels === "object") {
      for (const [id, label] of Object.entries(parsed.labels as Record<string, unknown>)) {
        const clean = cleanLabel(label);
        if (knownIds.has(id) && clean) labels.set(id, clean);
      }
    }
    const coldOpen = typeof parsed.coldOpen === "string" && knownIds.has(parsed.coldOpen) ? parsed.coldOpen : undefined;
    return { keep, coldOpen, labels };
  } catch {
    return null;
  }
}

export function highlightAiConfigured() {
  return aiConfigured();
}

async function askEditor(
  streamName: string,
  targetSec: number,
  passages: HighlightRequestPassage[]
): Promise<HighlightDecision | null> {
  if (!highlightAiConfigured() || passages.length === 0) return null;
  try {
    const result = await runAi({
      maxTokens: 3000,
      system: HIGHLIGHT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildHighlightPrompt({ streamName, targetSec, passages }) }]
    });
    if (!result || result.refused) return null;
    return parseHighlightDecision(result.text, new Set(passages.map((passage) => passage.id)));
  } catch {
    return null;
  }
}

export type BuiltHighlight = {
  highlight: LongformHighlight;
  segments: LongformSegment[];
  hook: LongformHook;
};

/**
 * Applies a set of enabled passages to a cut plan: the segments restricted to
 * them, and the hook re-pointed at the cold open (or the first passage). Used
 * both when the edit is first built and whenever a passage is swapped in or
 * out by hand.
 */
export function applyHighlight(input: {
  highlight: LongformHighlight;
  baseSegments: LongformSegment[];
  baseHook: LongformHook;
  transcript: CaptionSegment[];
}): BuiltHighlight {
  const windows = input.highlight.passages
    .filter((passage) => passage.enabled)
    .map((passage) => ({ start: passage.start, end: passage.end }));
  const segments = restrictSegments(input.baseSegments, windows);
  const mergedWindows = mergeWindows(windows);
  // A cold open whose passage was swapped out is gone from the edit, so it is
  // re-picked rather than opening the video on footage the video skips.
  const stillIn =
    input.highlight.coldOpen &&
    mergedWindows.some(
      (window) => input.highlight.coldOpen!.start >= window.start - 0.001 && input.highlight.coldOpen!.end <= window.end + 0.001
    );
  const coldOpen = stillIn ? input.highlight.coldOpen : pickColdOpen(input.transcript, mergedWindows);
  const hook = highlightHook(input.baseHook, input.transcript, mergedWindows, coldOpen);
  return {
    highlight: { ...input.highlight, coldOpen, opening: coldOpen ? "cold-open" : "natural" },
    segments,
    hook
  };
}

/**
 * The whole job: find the passages, let the editor pass (or the offline
 * scorer) choose them, label the chapters and apply it all to the cut plan.
 * Never throws for want of AI: no key or a bad reply falls back to the scorer
 * and keyword labels, so the button always produces an edit.
 */
export async function buildHighlight(input: {
  streamName: string;
  transcript: CaptionSegment[];
  baseSegments: LongformSegment[];
  baseHook: LongformHook;
  options?: Partial<HighlightOptions>;
}): Promise<BuiltHighlight | null> {
  const options = { ...DEFAULT_HIGHLIGHT_OPTIONS, ...input.options };
  const targetSec = Math.max(MIN_LONGFORM_SEC, options.targetSec);
  const planned = planPassages(input.transcript, options);
  if (planned.length === 0) return null;
  const runtimes = planned.map((passage) => keptSecondsIn(input.baseSegments, passage.start, passage.end));
  const ids = planned.map((_, index) => `p${index + 1}`);

  const decision = await askEditor(
    input.streamName,
    targetSec,
    planned.map((passage, index) => ({
      id: ids[index],
      at: formatChapterTime(passage.start),
      runtimeSec: runtimes[index],
      score: passage.score,
      text: passage.text
    }))
  );

  // The editor's pick is used only when it is roughly the length asked for;
  // a reply that keeps half the stream, or two passages, is not an edit.
  let picked = decision ? new Set(decision.keep.map((id) => ids.indexOf(id)).filter((index) => index >= 0)) : null;
  const totalRuntime = runtimes.reduce((sum, value) => sum + value, 0);
  const pickedRuntime = picked ? [...picked].reduce((sum, index) => sum + runtimes[index], 0) : 0;
  const floor = Math.min(totalRuntime, Math.max(MIN_LONGFORM_SEC, targetSec * 0.6));
  if (picked && (pickedRuntime < floor * 0.98 || pickedRuntime > targetSec * 1.5)) picked = null;
  const selectedBy: LongformHighlight["selectedBy"] = picked ? "ai" : "fallback";
  const chosen = picked ?? selectPassages(planned, runtimes, targetSec);
  if (chosen.size === 0) return null;

  const passages: LongformHighlightPassage[] = planned.map((passage, index) => {
    const aiLabel = decision?.labels.get(ids[index]);
    return {
      id: ids[index],
      start: passage.start,
      end: passage.end,
      score: passage.score,
      label: aiLabel || fallbackTopicTitle(passage.keywords, index),
      labelSource: aiLabel ? "ai" : "fallback",
      keywords: passage.keywords,
      opening: passage.opening,
      picked: chosen.has(index),
      enabled: chosen.has(index)
    };
  });

  // The editor's cold-open passage narrows where the line is looked for; the
  // line itself is still the strongest sentence in it.
  const enabledWindows = passages.filter((passage) => passage.enabled).map((passage) => ({ start: passage.start, end: passage.end }));
  const coldOpenIndex = decision?.coldOpen ? ids.indexOf(decision.coldOpen) : -1;
  let coldOpen: LongformHighlight["coldOpen"] | undefined;
  if (coldOpenIndex >= 0 && chosen.has(coldOpenIndex)) {
    coldOpen = pickColdOpen(input.transcript, [
      mergeWindows(enabledWindows)[0],
      { start: planned[coldOpenIndex].start, end: planned[coldOpenIndex].end }
    ]);
  }
  coldOpen ??= pickColdOpen(input.transcript, enabledWindows);

  return applyHighlight({
    highlight: {
      targetSec,
      passages,
      opening: coldOpen ? "cold-open" : "natural",
      coldOpen,
      selectedBy,
      builtAt: new Date().toISOString()
    },
    baseSegments: input.baseSegments,
    baseHook: input.baseHook,
    transcript: input.transcript
  });
}

/** Runtime the enabled passages add up to once their dead space is cut. */
export function highlightRuntimeSec(highlight: LongformHighlight, segments: LongformSegment[]): number {
  return round3(
    highlight.passages
      .filter((passage) => passage.enabled)
      .reduce((sum, passage) => sum + keptSecondsIn(segments, passage.start, passage.end), 0)
  );
}
