import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL_KEYWORDS } from "@/lib/clipping/titles";
import { carouselSchema } from "@/lib/storage/schemas";
import type { Carousel, CarouselSlide } from "@/types/domain";

/**
 * Instagram carousel copy. Turns a video's script or transcript into a
 * swipeable set of slides — hook slide, value slides, CTA slide — that the
 * client renders to 1080x1350 PNGs on a canvas (no server-side image deps).
 *
 * House AI pattern: *Configured() gate, pure prompt builder, tolerant
 * parser, graceful fallback.
 */

export const DEFAULT_SLIDE_COUNT = 8;
export const MIN_SLIDES = 4;
export const MAX_SLIDES = 10;

export function carouselGenerationConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export const CAROUSEL_SYSTEM_PROMPT = `You write Instagram carousel copy for a creator who builds software with AI in public (a structural engineer building CoLateral, an AI workspace for structural engineers). Channel keywords: ${CHANNEL_KEYWORDS.join(", ")}.

Carousel rules:
- Slide 1 is the HOOK: a bold, specific claim or question — max 12 words in "heading", "body" empty or one short kicker line.
- Middle slides each carry ONE idea: "heading" max 8 words, "body" 1-3 short sentences (max 220 characters) that deliver — not tease — the idea.
- The last slide is the CTA: heading invites the follow / the video, body one line. Never salesy, never "link in bio" begging.
- Plain, confident language. No hashtags on slides, no emoji spam (one emoji max across the whole set), no invented facts or numbers.

You always return strict JSON.`;

/** Builds the carousel prompt. Pure, for tests. */
export function buildCarouselPrompt(input: { title: string; sourceText: string; slideCount: number }): string {
  return [
    `Turn this video content into an Instagram carousel of exactly ${input.slideCount} slides.`,
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
      { heading: input.title, body: "" },
      ...middles.map((body, i) => ({ heading: `Point ${i + 1}`, body: body.slice(0, 220) })),
      { heading: "Follow for the full build", body: "New AI + engineering videos every week." }
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
    return { carousel: fallback(), reason: "ANTHROPIC_API_KEY is not set — built simple slides from the text instead." };
  }
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      system: CAROUSEL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildCarouselPrompt({ title: input.title, sourceText: input.sourceText, slideCount }) }]
    });
    if (response.stop_reason === "refusal") {
      return { carousel: fallback(), reason: "The model declined the request — built simple slides instead." };
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const parsed = parseCarousel(text);
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
