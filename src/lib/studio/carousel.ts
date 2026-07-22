import { aiConfigured, runAi } from "@/lib/ai";
import { CHANNEL_KEYWORDS } from "@/lib/clipping/keywords";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import { carouselSchema } from "@/lib/storage/schemas";
import type { Carousel, CarouselSlide } from "@/types/domain";

/**
 * Carousel copy for Instagram, Facebook, and TikTok. Turns a video's script or
 * transcript into a swipeable set of slides — hook slide, value slides, CTA
 * slide — that the client renders to 1080x1350 PNGs on a canvas (no
 * server-side image deps).
 *
 * House AI pattern: *Configured() gate, pure prompt builder, tolerant
 * parser, graceful fallback.
 */

export const DEFAULT_SLIDE_COUNT = 8;
export const MIN_SLIDES = 4;
export const MAX_SLIDES = 10;

export function carouselGenerationConfigured() {
  return aiConfigured();
}

export const CAROUSEL_SYSTEM_PROMPT = `You write carousel copy for a creator who builds software with AI in public (a structural engineer building CoLateral, an AI workspace for structural engineers). The same carousel is posted across Instagram, Facebook, and TikTok, so keep the copy platform-neutral — no "Instagram" / "IG"-only references, and nothing that only makes sense on one network. Channel keywords: ${CHANNEL_KEYWORDS.join(", ")}.

Carousel rules:
- Slide 1 is the HOOK: a bold, specific claim or question — max 12 words in "heading", "body" empty or one short kicker line.
- Middle slides each carry ONE idea: "heading" max 8 words, "body" 1-3 short sentences (max 220 characters) that deliver — not tease — the idea.
- The last slide is the CTA: heading invites the follow / the video, body one line. Never salesy, never "link in bio" begging.
- Plain, confident language. No hashtags on slides, no invented facts or numbers.
- Use emojis liberally to add energy and scroll-stopping personality — aim for one or two relevant emojis on most slides (in the heading, at the start of a body line, or as a bullet marker). Pick emojis that reinforce the idea (🚀 momentum, 🧠 insight, ⚡ speed, 💡 idea, 🔥 hot take, 📈 growth, 🤖 AI, 🛠️ building). Keep them tasteful — a couple per slide, never a wall of them.

You always return strict JSON.`;

/**
 * Turns a short-form video (a clip) into carousel source material: its title
 * plus the words spoken inside the clip window, pulled from the job's
 * source-relative captions. Falls back to the clip's hook quote and rationale
 * when no transcript has been fetched yet, so a clip is never un-carouselable.
 */
export function clipCarouselSource(job: ClipJob, clip: ClipCandidate): { title: string; text: string } {
  const title = clip.title?.trim() || job.topic?.trim() || job.fileName?.trim() || "Short-form video";
  const spoken = (job.sourceCaptions ?? [])
    .filter((segment) => segment.enabled !== false && segment.end > clip.start && segment.start < clip.end)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // Prefer the spoken transcript; otherwise stitch together whatever the clip
  // analysis captured so there is still something to write slides from.
  const parts = [title, spoken || clip.hookQuote?.trim() || "", spoken ? "" : clip.rationale?.trim() || ""];
  return { title, text: parts.filter(Boolean).join("\n\n") };
}

/** Builds the carousel prompt. Pure, for tests. */
export function buildCarouselPrompt(input: { title: string; sourceText: string; slideCount: number }): string {
  return [
    `Turn this video content into a carousel of exactly ${input.slideCount} slides (for Instagram, Facebook, and TikTok).`,
    "",
    `Video: ${input.title}`,
    "",
    "Content:",
    input.sourceText.slice(0, 9000),
    "",
    'Respond with ONLY valid JSON: {"title":"short internal name for this carousel","slides":[{"heading":"...","body":"..."}]}'
  ].join("\n");
}

/** Parses slides out of the model reply. */
export function parseCarousel(text: string): { title: string; slides: Array<Pick<CarouselSlide, "heading" | "body">> } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { title?: unknown; slides?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.slides)) return null;
    const slides = parsed.slides
      .map((slide) => ({
        heading: typeof slide.heading === "string" ? slide.heading.trim() : "",
        body: typeof slide.body === "string" ? slide.body.trim() : ""
      }))
      .filter((slide) => slide.heading || slide.body)
      .slice(0, MAX_SLIDES);
    if (slides.length < 2) return null;
    return { title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Carousel", slides };
  } catch {
    return null;
  }
}

/** Offline fallback: split the source text into simple slides. */
export function fallbackCarousel(input: { title: string; sourceText: string; slideCount: number }): {
  title: string;
  slides: Array<Pick<CarouselSlide, "heading" | "body">>;
} {
  const sentences = input.sourceText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
  const middleCount = Math.max(2, Math.min(input.slideCount - 2, sentences.length));
  const step = Math.max(1, Math.floor(sentences.length / middleCount));
  const middles = Array.from({ length: middleCount }, (_, i) => sentences[Math.min(i * step, sentences.length - 1)] ?? "");
  return {
    title: input.title,
    slides: [
      { heading: `${input.title} 🚀`, body: "" },
      ...middles.map((body, i) => ({ heading: `💡 Point ${i + 1}`, body: body.slice(0, 220) })),
      { heading: "Follow for the full build 🔨", body: "New AI + engineering videos every week ⚡" }
    ]
  };
}

/** Assembles the persisted record. */
export function toCarouselRecord(input: {
  title: string;
  slides: Array<Pick<CarouselSlide, "heading" | "body">>;
  sourceType: Carousel["sourceType"];
  sourceId?: string;
}): Carousel {
  return carouselSchema.parse({
    id: `carousel-${crypto.randomUUID()}`,
    title: input.title,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    slides: input.slides.map((slide) => ({ id: `slide-${crypto.randomUUID().slice(0, 8)}`, ...slide })),
    createdAt: new Date().toISOString()
  }) as Carousel;
}

/**
 * Writes carousel copy from source text in one Claude call. Never throws —
 * falls back to sentence-split slides with a reason.
 */
export async function generateCarousel(input: {
  title: string;
  sourceText: string;
  slideCount: number;
  sourceType: Carousel["sourceType"];
  sourceId?: string;
}): Promise<{ carousel: Carousel; reason: string | null }> {
  const slideCount = Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, input.slideCount || DEFAULT_SLIDE_COUNT));
  const fallback = () =>
    toCarouselRecord({ ...fallbackCarousel({ ...input, slideCount }), sourceType: input.sourceType, sourceId: input.sourceId });

  if (!carouselGenerationConfigured()) {
    return { carousel: fallback(), reason: "AI is not configured — built simple slides from the text instead." };
  }
  try {
    const result = await runAi({
      maxTokens: 3000,
      system: CAROUSEL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildCarouselPrompt({ title: input.title, sourceText: input.sourceText, slideCount }) }]
    });
    if (!result || result.refused) {
      return { carousel: fallback(), reason: "The model was unavailable or declined — built simple slides instead." };
    }
    const parsed = parseCarousel(result.text);
    if (!parsed) {
      return { carousel: fallback(), reason: "Could not read the carousel output — built simple slides instead." };
    }
    return {
      carousel: toCarouselRecord({
        title: parsed.title === "Carousel" ? input.title : parsed.title,
        slides: parsed.slides,
        sourceType: input.sourceType,
        sourceId: input.sourceId
      }),
      reason: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { carousel: fallback(), reason: `Carousel generation failed (${message}) — built simple slides instead.` };
  }
}
