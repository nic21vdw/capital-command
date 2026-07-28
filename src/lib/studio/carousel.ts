import { aiConfigured, runAi } from "@/lib/ai";
import { carouselAngle, clampBatchCount, MAX_SLIDES, resolveSlideCount } from "@/lib/carousels/deck";
import { attachSlideImages, type CarouselImage } from "@/lib/carousels/imageSlides";
import { CHANNEL_KEYWORDS } from "@/lib/clipping/keywords";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import { carouselSchema } from "@/lib/storage/schemas";
import type { Carousel, CarouselBatch, CarouselSlide } from "@/types/domain";

/**
 * Carousel copy for Instagram, Facebook, and TikTok. Turns a video's script or
 * transcript into a swipeable set of slides — hook slide, value slides, CTA
 * slide — that the client renders to 1080x1350 PNGs on a canvas (no
 * server-side image deps).
 *
 * One source can produce several carousels in a pass (batches), and a batch of
 * uploaded photos can ride along as slide material — see CAROUSEL_ANGLES and
 * `generateCarouselBatches`.
 *
 * House AI pattern: *Configured() gate, pure prompt builder, tolerant
 * parser, graceful fallback.
 */

export {
  CAROUSEL_ANGLES,
  carouselAngle,
  clampBatchCount,
  DEFAULT_BATCH_COUNT,
  DEFAULT_SLIDE_COUNT,
  MAX_BATCH_COUNT,
  MAX_SLIDES,
  MIN_SLIDES,
  resolveSlideCount
} from "@/lib/carousels/deck";

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
export function buildCarouselPrompt(input: {
  title: string;
  sourceText: string;
  slideCount: number;
  /** The brief for this batch, when several are being written from one source. */
  angle?: string;
  batchIndex?: number;
  batchTotal?: number;
  /** How many leading slides already carry an uploaded photo. */
  imageCount?: number;
  /** What the photos show / how they should be used, in the user's words. */
  imageNotes?: string;
}): string {
  const lines = [
    `Turn this video content into a carousel of exactly ${input.slideCount} slides (for Instagram, Facebook, and TikTok).`,
    ""
  ];
  if (input.batchTotal && input.batchTotal > 1) {
    lines.push(
      `This is carousel ${input.batchIndex ?? 1} of ${input.batchTotal} written from the SAME source. It must stand on its own and must not repeat the others — commit to one angle.`,
      ""
    );
  }
  if (input.angle?.trim()) {
    lines.push(`Angle for this carousel: ${input.angle.trim()}`, "");
  }
  lines.push(`Video: ${input.title}`, "");
  if (input.imageCount && input.imageCount > 0) {
    const plural = input.imageCount === 1 ? "" : "s";
    lines.push(
      `The first ${input.imageCount} slide${plural} already carr${input.imageCount === 1 ? "ies" : "y"} a supplied photo across the top, in the order listed below. Write each of those slides as the caption for its own photo — the copy and the photo have to make sense together — and never describe a photo that was not described to you.`,
      ""
    );
  }
  if (input.imageNotes?.trim()) {
    lines.push("The photos, in order, and how they should be used:", input.imageNotes.trim().slice(0, 2000), "");
  }
  lines.push(
    "Content:",
    input.sourceText.slice(0, 9000),
    "",
    'Respond with ONLY valid JSON: {"title":"short internal name for this carousel","slides":[{"heading":"...","body":"..."}]}'
  );
  return lines.join("\n");
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
  // Always the full deck: a photo batch sizes the deck, and a short fallback
  // would leave the last photos with no slide to sit on.
  const middleCount = Math.max(2, input.slideCount - 2);
  const step = sentences.length / middleCount;
  const middles = Array.from(
    { length: middleCount },
    (_, i) => sentences[Math.min(Math.floor(i * step), sentences.length - 1)] ?? ""
  );
  return {
    title: input.title,
    slides: [
      { heading: `${input.title} 🚀`, body: "" },
      ...middles.map((body, i) => ({ heading: `💡 Point ${i + 1}`, body: body.slice(0, 220) })),
      { heading: "Follow for the full build 🔨", body: "New AI + engineering videos every week ⚡" }
    ]
  };
}

/**
 * Assembles the persisted record. Photos are attached last, so a slide's copy
 * is written first and then gets its picture — never the other way round.
 */
export function toCarouselRecord(input: {
  title: string;
  slides: Array<Pick<CarouselSlide, "heading" | "body">>;
  sourceType: Carousel["sourceType"];
  sourceId?: string;
  images?: CarouselImage[];
  batch?: CarouselBatch;
}): Carousel {
  const slides: CarouselSlide[] = input.slides.map((slide) => ({
    id: `slide-${crypto.randomUUID().slice(0, 8)}`,
    ...slide
  }));
  return carouselSchema.parse({
    id: `carousel-${crypto.randomUUID()}`,
    title: input.title,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    slides: input.images?.length ? attachSlideImages(slides, input.images) : slides,
    batch: input.batch,
    createdAt: new Date().toISOString()
  }) as Carousel;
}

/**
 * Pads a deck out to the number of photos waiting for it. The model is asked
 * for exactly the right count but sometimes writes fewer; a photo with no slide
 * would simply vanish, so it gets a blank slide to sit on instead and the
 * shortfall is reported.
 */
function padForImages(
  slides: Array<Pick<CarouselSlide, "heading" | "body">>,
  imageCount: number
): { slides: Array<Pick<CarouselSlide, "heading" | "body">>; missing: number } {
  const missing = Math.max(0, imageCount - slides.length);
  if (missing === 0) return { slides, missing };
  return {
    slides: [...slides, ...Array.from({ length: missing }, () => ({ heading: "", body: "" }))],
    missing
  };
}

/**
 * Writes carousel copy from source text in one Claude call. Never throws —
 * falls back to sentence-split slides with a reason.
 */
/**
 * How many times to ask the model before giving up. The free endpoint declines
 * or drops a request often enough that one attempt is not a fair test, and the
 * cost of a retry is far lower than the cost of shipping the fallback.
 */
const CAROUSEL_ATTEMPTS = 3;

export type CarouselGenerationInput = {
  title: string;
  sourceText: string;
  slideCount: number;
  sourceType: Carousel["sourceType"];
  sourceId?: string;
  /** The brief for this batch — see CAROUSEL_ANGLES. */
  angle?: string;
  /** Photos to sit on the leading slides, in order. */
  images?: CarouselImage[];
  /** What those photos show, in the user's words. */
  imageNotes?: string;
  batch?: CarouselBatch;
  /**
   * Return `carousel: null` instead of transcript-derived slides when the model
   * cannot be reached.
   *
   * The fallback exists for the Video Studio, where a person is looking at the
   * result and can rewrite it. Unattended — the Stream Pipeline — it is worse
   * than nothing: `fallbackCarousel` slices the transcript, which reads as
   * broken mid-sentence thoughts and is exactly what the channel's copy
   * conventions forbid. Silently counting those as slides "ready to schedule"
   * is how unusable copy reaches a queue.
   */
  requireModel?: boolean;
};

export async function generateCarousel(
  input: CarouselGenerationInput
): Promise<{ carousel: Carousel | null; reason: string | null }> {
  const images = input.images ?? [];
  const slideCount = resolveSlideCount({ slideCount: input.slideCount, imageCount: images.length });
  const give = (reason: string): { carousel: Carousel | null; reason: string } => {
    if (input.requireModel) return { carousel: null, reason };
    return {
      carousel: toCarouselRecord({
        ...fallbackCarousel({ ...input, slideCount }),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        images,
        batch: input.batch
      }),
      reason
    };
  };

  if (!carouselGenerationConfigured()) {
    return give("AI is not configured — built simple slides from the text instead.");
  }

  const prompt = buildCarouselPrompt({
    title: input.title,
    sourceText: input.sourceText,
    slideCount,
    angle: input.angle,
    batchIndex: input.batch?.index,
    batchTotal: input.batch?.total,
    imageCount: images.length,
    imageNotes: input.imageNotes
  });

  let last = "The model was unavailable or declined.";
  for (let attempt = 1; attempt <= CAROUSEL_ATTEMPTS; attempt += 1) {
    try {
      const result = await runAi({
        maxTokens: 3000,
        system: CAROUSEL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }]
      });
      if (!result || result.refused) {
        last = "The model was unavailable or declined.";
      } else {
        const parsed = parseCarousel(result.text);
        if (parsed) {
          const padded = padForImages(parsed.slides, images.length);
          return {
            carousel: toCarouselRecord({
              title: parsed.title === "Carousel" ? input.title : parsed.title,
              slides: padded.slides,
              sourceType: input.sourceType,
              sourceId: input.sourceId,
              images,
              batch: input.batch
            }),
            reason: padded.missing
              ? `${padded.missing} photo${padded.missing === 1 ? "" : "s"} got a slide with no copy written for it — add the words in the editor.`
              : null
          };
        }
        last = "Could not read the carousel output.";
      }
    } catch (error) {
      last = `Carousel generation failed (${error instanceof Error ? error.message : "unknown error"}).`;
    }
  }

  return give(
    input.requireModel
      ? `${last} Tried ${CAROUSEL_ATTEMPTS} times — no slides written rather than slicing the transcript.`
      : `${last} Built simple slides instead.`
  );
}

/**
 * Writes several carousels from one source in a single pass — "3 batches of 8
 * slides from this stream".
 *
 * Each batch gets its own angle so the set is three different posts rather than
 * three rewrites, and they run concurrently: a batch takes minutes on the free
 * endpoint, and five of those in series is a request nobody waits out. Batches
 * fail independently — whatever came back is returned, with a note about what
 * did not.
 */
export async function generateCarouselBatches(
  input: Omit<CarouselGenerationInput, "angle" | "batch"> & { batchCount?: number }
): Promise<{ carousels: Carousel[]; reason: string | null }> {
  const total = clampBatchCount(input.batchCount);
  const groupId = crypto.randomUUID().slice(0, 8);

  const results = await Promise.all(
    Array.from({ length: total }, (_, index) => {
      const angle = carouselAngle(index);
      return generateCarousel({
        ...input,
        // A single carousel is asked for exactly as it always was — no angle, no
        // batch record — so the Stream Pipeline's slides do not change shape.
        angle: total > 1 ? angle.instruction : undefined,
        batch: total > 1 ? { groupId, index: index + 1, total, angle: angle.label } : undefined
      });
    })
  );

  const carousels = results.map((result) => result.carousel).filter((carousel): carousel is Carousel => Boolean(carousel));
  const notes = [...new Set(results.map((result) => result.reason).filter((reason): reason is string => Boolean(reason)))];
  const short = total - carousels.length;
  const reason = [short > 0 ? `${carousels.length} of ${total} batches came back.` : "", ...notes]
    .filter(Boolean)
    .join(" ");
  return { carousels, reason: reason || null };
}
