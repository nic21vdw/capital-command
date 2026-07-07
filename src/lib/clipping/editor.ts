import { CAPTION_PRESETS } from "@/lib/clipping/captions";
import {
  defaultCaptionStyle,
  defaultClipAudio,
  defaultClipExportSettings
} from "@/lib/storage/schemas";
import type {
  AspectRatioId,
  CaptionSegment,
  CaptionPresetId,
  CaptionStyle,
  ClipProject,
  ExportPresetId
} from "@/types/domain";

/** Output pixel dimensions for each aspect ratio. */
export const ASPECT_DIMENSIONS: Record<Exclude<AspectRatioId, "custom">, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 }
};

export const ASPECT_LABELS: Record<AspectRatioId, string> = {
  "9:16": "9:16 Vertical",
  "16:9": "16:9 Landscape",
  "1:1": "1:1 Square",
  "4:5": "4:5 Portrait",
  custom: "Custom"
};

export const EXPORT_PRESETS: Record<ExportPresetId, { label: string; w: number; h: number; aspect: AspectRatioId }> = {
  shorts: { label: "YouTube Shorts", w: 1080, h: 1920, aspect: "9:16" },
  longform: { label: "YouTube Long-form", w: 1920, h: 1080, aspect: "16:9" },
  square: { label: "Square Social", w: 1080, h: 1080, aspect: "1:1" },
  portrait: { label: "Portrait Social", w: 1080, h: 1350, aspect: "4:5" },
  custom: { label: "Custom", w: 1080, h: 1920, aspect: "custom" }
};

export function aspectDimensions(aspect: AspectRatioId): { w: number; h: number } {
  return aspect === "custom" ? { w: 1080, h: 1920 } : ASPECT_DIMENSIONS[aspect];
}

export function applyCaptionPreset(style: CaptionStyle, preset: CaptionPresetId): CaptionStyle {
  // Presets bring their own `position`, so drop any drag-placed offsets.
  return { ...style, ...CAPTION_PRESETS[preset].style, offsetX: undefined, offsetY: undefined };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// Spoken disfluencies and weak fillers dropped from anywhere in a title.
const TITLE_FILLERS = new Set([
  "um", "uh", "er", "erm", "ah", "oh", "hmm", "like", "basically", "actually",
  "honestly", "literally", "really", "just", "kinda", "sorta", "yeah", "yep",
  "okay", "ok", "right", "anyway", "anyways", "obviously", "essentially"
]);

// Weak words that make a poor first or last word of a title (articles,
// prepositions, conjunctions, auxiliaries, pronouns). Trimmed only from the
// edges — kept in the interior so the phrase stays grammatical.
const WEAK_EDGE_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "so", "for", "to", "of", "in",
  "on", "at", "by", "with", "as", "from", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "am", "i", "we", "you", "he",
  "she", "it", "they", "my", "our", "your", "then", "now", "well", "because",
  "cause", "if", "when", "while", "about", "into", "than", "there", "here"
]);

// Small words kept lowercase in the middle of a title (proper title case).
const LOWERCASE_IN_TITLE = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "of", "to", "in", "on",
  "at", "by", "with", "as", "from", "vs", "via", "per"
]);

// Punchy, curiosity-driving words that make a clip title land on YouTube.
const HOOK_WORDS = new Set([
  "why", "how", "what", "secret", "secrets", "never", "always", "best", "worst",
  "biggest", "reason", "mistake", "mistakes", "truth", "stop", "need", "should",
  "must", "real", "proven", "easy", "fast", "free", "new", "ultimate", "insane",
  "crazy", "warning", "avoid", "nobody", "everyone", "everything", "actually",
  "wrong", "right", "win", "winning", "lose", "money", "growth"
]);

function smartTitleCase(words: string[]): string {
  return words
    .map((word, i) => {
      // Preserve short acronyms already in caps (AI, NFT, SEO, USA).
      if (word.length <= 4 && /^[A-Z0-9]+$/.test(word) && /[A-Z]/.test(word)) return word;
      const lower = word.toLowerCase();
      if (i !== 0 && i !== words.length - 1 && LOWERCASE_IN_TITLE.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Turns a raw spoken sentence into a tidy, YouTube-ready title, or "" if the
 *  fragment is too thin — or too long to fit whole — to make a real title.
 *  Never truncates mid-sentence: a title is either the complete thought or
 *  it is rejected, so clips never end up with a broken-off fragment. */
function titleFromSentence(sentence: string, maxWords = 12, maxChars = 90): string {
  let tokens = sentence
    // Drop caption noise markers like [Music] or (laughs).
    .replace(/[\[(][^\])]*[\])]/g, " ")
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    // Strip pure disfluencies from anywhere in the phrase.
    .filter((word) => !TITLE_FILLERS.has(word.toLowerCase()));

  // Trim weak opener/closer words so titles don't start on "Is The…" or end
  // on a dangling "…We Want To".
  while (tokens.length && WEAK_EDGE_WORDS.has(tokens[0].toLowerCase())) tokens.shift();
  while (tokens.length && WEAK_EDGE_WORDS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();

  if (tokens.length < 3) return "";
  // Reject rather than truncate: a partial sentence reads as a broken
  // thought, so it's better to fall back to a different candidate.
  if (tokens.length > maxWords) return "";

  const title = smartTitleCase(tokens);
  if (title.length > maxChars) return "";
  return title.trim();
}

/** Rough "how clickable is this" score used to rank title candidates. */
function scoreTitle(title: string): number {
  const words = title.split(/\s+/);
  let score = 0;
  const n = words.length;
  if (n >= 4 && n <= 9) score += 3;
  else if (n === 3 || n === 10 || n === 11) score += 1;
  for (const word of words) {
    if (HOOK_WORDS.has(word.toLowerCase())) score += 2;
    if (/^\d/.test(word)) score += 2;
  }
  if (title.length >= 30 && title.length <= 65) score += 2;
  return score;
}

function transcriptText(captions: CaptionSegment[]): string {
  return captions
    .map((caption) => caption.text)
    .join(" ")
    .replace(/[\[(][^\])]*[\])]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every distinct title candidate the captions can produce, best first. */
export function generateClipTitleCandidates(captions: CaptionSegment[]): string[] {
  const text = transcriptText(captions);
  if (!text) return [];

  const sentences = text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().split(/\s+/).length >= 3);
  const raw = (sentences.length ? sentences : [text]).map((s) => titleFromSentence(s));

  // If punctuation gave us little to work with (common with auto-captions),
  // also slice the transcript into overlapping windows for more options.
  if (raw.filter(Boolean).length < 3) {
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length && raw.length < 12; i += 6) {
      raw.push(titleFromSentence(words.slice(i, i + 9).join(" ")));
    }
  }

  const seen = new Set<string>();
  const scored = raw
    .filter(Boolean)
    .filter((title) => {
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((title, idx) => ({ title, score: scoreTitle(title), idx }));

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((entry) => entry.title);
}

/**
 * Picks a title from the captions. Without `avoid`, returns the best-scored
 * candidate (stable for auto-titling). With `avoid` set to the current title,
 * re-rolls: picks a random candidate other than `avoid` when possible.
 */
export function generateClipTitle(captions: CaptionSegment[], fallback = "Untitled clip", avoid?: string): string {
  const candidates = generateClipTitleCandidates(captions);
  if (!candidates.length) return fallback;
  if (avoid === undefined) return candidates[0];
  const fresh = candidates.filter((candidate) => candidate !== avoid);
  const pool = fresh.length ? fresh : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Common words never worth turning into a hashtag.
const HASHTAG_STOPWORDS = new Set([
  "about", "after", "again", "against", "along", "already", "also", "although",
  "always", "another", "around", "because", "become", "before", "being",
  "below", "between", "both", "cannot", "could", "doing", "done", "down",
  "during", "each", "either", "enough", "even", "ever", "every", "from",
  "gonna", "gotta", "have", "here", "hers", "himself", "into", "itself",
  "just", "keep", "kind", "like", "little", "make", "many", "maybe", "mean",
  "might", "more", "most", "much", "must", "myself", "never", "next", "night",
  "nothing", "only", "other", "over", "really", "right", "said", "same",
  "should", "since", "some", "something", "still", "such", "sure", "take",
  "than", "that", "their", "them", "then", "there", "these", "they", "thing",
  "things", "think", "this", "those", "through", "time", "today", "together",
  "under", "until", "very", "want", "well", "were", "what", "when", "where",
  "which", "while", "with", "without", "would", "your", "yourself", "yeah",
  "okay", "going", "know", "just", "were", "been", "will", "your", "look",
  "looking", "come", "coming", "goes", "getting", "guys", "guy", "stuff"
]);

/** Topical hashtags pulled from the most-repeated meaningful words. */
export function generateClipHashtags(captions: CaptionSegment[], max = 4): string[] {
  const text = transcriptText(captions).toLowerCase();
  if (!text) return [];
  const counts = new Map<string, number>();
  for (const raw of text.split(/[^a-z0-9]+/)) {
    const word = raw.trim();
    if (word.length < 4 || HASHTAG_STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => `#${word.charAt(0).toUpperCase()}${word.slice(1)}`);
}

/** Standing description applied to every generated clip/short, regardless of
 *  transcript content — the CoLateral "build in public" boilerplate. */
export const CLIP_DESCRIPTION_TEMPLATE = `I’m building CoLateral, the all-in-one engineering workspace for structural engineers, designers, and technical professionals who want better tools for calculations, drafting, project workflows, and AI-powered engineering work.

Follow along as I build CoLateral in public.

Try / follow CoLateral:
https://colateral.ai

Connect with me:
YouTube: @NicVandewetering
TikTok: @nicvandewetering
Instagram: @nicvandewetering
X: @nicvandeweter
Threads: @nicvandewetering

#BuildInPublic #ContentCreation #YouTubeCreator #JustPostIt #AI #Engineering #StructuralEngineering #CoLateral #Startup #CreatorEconomy #AITools #Productivity #Tech #Entrepreneurship`;

/** Publish-ready description for a clip. Every generated clip uses the same
 *  standing CoLateral description. */
export function generateClipDescription(_captions: CaptionSegment[]): string {
  return CLIP_DESCRIPTION_TEMPLATE;
}

/**
 * Seconds of dead air at the very start of a clip — the clip-local start time
 * of the first spoken word. Previews seek past this so a clip that opens on a
 * pause doesn't spend the viewer's first seconds on silence.
 *
 * `captions` must already be windowed to clip-local time (t=0 is the clip's
 * first frame), e.g. via `windowSegments(sourceCaptions, clip.start, clip.end)`.
 * Returns 0 when there's no transcript or the opening pause is too short to be
 * worth skipping; keeps a small pre-roll so the first word is never clipped.
 */
export function leadingSilenceSec(
  captions: CaptionSegment[],
  options?: { minSkipSec?: number; preRollSec?: number }
): number {
  const minSkip = options?.minSkipSec ?? 0.5;
  const preRoll = options?.preRollSec ?? 0.12;
  let firstWordStart = Infinity;
  for (const seg of captions) {
    if (seg.words.length > 0) firstWordStart = Math.min(firstWordStart, seg.words[0].start);
    else if (seg.text.trim()) firstWordStart = Math.min(firstWordStart, seg.start);
  }
  if (!Number.isFinite(firstWordStart) || firstWordStart < minSkip) return 0;
  return Math.max(0, firstWordStart - preRoll);
}

/**
 * Builds a fresh clip project from a rendered 16:9 source master. Projects
 * open Shorts/Reels-ready: 9:16 vertical, blur-filled framing, and word-synced
 * captions on — the goal is export-and-upload with zero extra setup.
 */
export function makeClipProject(input: {
  jobId: string;
  name: string;
  sourceFile: string;
  posterFile?: string;
  sourceUrl: string;
  clipStart: number;
  clipEnd: number;
}): ClipProject {
  const now = new Date().toISOString();
  const duration = Math.max(0.1, input.clipEnd - input.clipStart);
  return {
    id: `clip-${crypto.randomUUID()}`,
    name: input.name,
    jobId: input.jobId,
    sourceFile: input.sourceFile,
    posterFile: input.posterFile,
    sourceUrl: input.sourceUrl,
    baseDurationSec: duration,
    baseWidth: 1920,
    baseHeight: 1080,
    clipStart: input.clipStart,
    clipEnd: input.clipEnd,
    trimStart: 0,
    trimEnd: duration,
    title: "",
    aspectRatio: "9:16",
    compositionMode: "center-blur",
    reframe: { scale: 1, offsetX: 0, offsetY: 0 },
    captions: [],
    captionStyle: { ...defaultCaptionStyle },
    captionsVisible: true,
    highlightCurrentWord: true,
    overlays: [],
    audio: { ...defaultClipAudio },
    exportSettings: { ...defaultClipExportSettings },
    suggestions: [],
    createdAt: now,
    updatedAt: now
  };
}
