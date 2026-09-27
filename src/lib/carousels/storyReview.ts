import { copyFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeCodeEnabled, runClaudeCode } from "@/lib/ai/claudeCode";
import { titleCaseHeading } from "@/lib/carousels/deck";
import { BACKDROP_SLIDE_LAYOUT } from "@/lib/carousels/imageSlides";
import { carouselImagePath, parseCarouselImageId } from "@/lib/carousels/uploads";
import type { Carousel, CarouselSlide, SlideLayer } from "@/types/domain";

export type ReviewedSlide = { heading: string; body: string; picture: "keep" | "drop" };
export type StoryReview = { slides: ReviewedSlide[]; notes: string };

type ImageLayer = Extract<SlideLayer, { type: "image" }>;

function backdropOf(slide: CarouselSlide): ImageLayer | null {
  const layer = (slide.layers ?? []).find((entry): entry is ImageLayer => entry.type === "image" && entry.fit === "frame");
  return layer ?? null;
}

export function buildReviewPrompt(slides: CarouselSlide[], pictures: Array<string | null>): string {
  const hasPictures = pictures.some(Boolean);
  const deck = slides.map((slide, index) => ({
    slide: index + 1,
    heading: slide.heading,
    body: slide.body,
    ...(hasPictures ? { picture: pictures[index] ?? "none" } : {})
  }));
  const pictureSteps = hasPictures
    ? [
        "Open every picture listed below with the Read tool and look at it. Do not skip any.",
        "Judge each slide's words against its picture. The words must be true of what the reader will SEE. If the picture shows something different from the words:",
        "   - if what it shows still belongs to this deck's story, rewrite that slide's heading and body so they are about what is on screen, keeping the story's thread;",
        "   - otherwise set \"picture\" to \"drop\" and keep the words. A slide with no picture is better than a slide whose picture contradicts it.",
        "   Also drop a picture that is black, blurred, mid-transition, or shows nothing a reader could recognise.",
        "   Drop a picture that looks like an earlier slide's picture (the same screen, the same shot): a repeat adds nothing, and a slide without a picture is set large on the brand background instead. Keep the one that fits its words best.",
        "   Slide 1 keeps its picture only if the picture itself stops a scroll — a face reacting, a result on screen, something big and legible. A wall of small text or an ordinary screen is dropped so the hook is set large."
      ]
    : [];
  const storySteps = [
    "Find the story in the deck as it stands and state it to yourself as one sentence: \"I needed X, but Y, so Z, which meant W\". If the deck does not tell one story, rewrite the slides that wander until it does.",
    "Swipe it as a stranger with their thumb. Score slide 1 for \"would I stop scrolling?\" and every other slide for \"would I swipe to the next one?\", 1-10. Rewrite every slide that scores under 9 until it would score 9: a sharper stake on the hook, a real cause-and-effect link (BUT or SO, never AND THEN) to the slide before, and a swipe bridge — a closing line that leaves something open for the next slide to answer — on every slide but the last. Bridges are concrete and different from each other, and never name the swipe.",
    "Hold the payoff back: the hook's question is answered on the payoff slide, not earlier.",
    "Check the CoLateral plug: where the session shows CoLateral, a middle slide is about what it specifically did — and a slide that only recites what CoLateral is gets rewritten into a real beat of the story. The last slide names CoLateral and invites the reader to try it as well as giving the reason to follow, in under 160 characters. It must not spell out the web address: the design already puts colateralai.com on every slide and a button on the last one.",
    "Check the bold: the keywords that carry each slide are wrapped in **double asterisks**, one phrase at most in a heading, one to three in a body, never a whole sentence.",
    "Check the voice: first person as the creator (\"I\", \"my\"), never \"he\"."
  ];
  const steps = [...pictureSteps, ...storySteps];
  let number = 0;
  const numbered = steps.map((step) => (step.startsWith("   ") ? step : `${(number += 1)}. ${step}`));
  return [
    hasPictures
      ? "You are reviewing a carousel before it is posted. It was written from a recording, and each slide's picture is a still cut from that recording at the moment the slide is about."
      : "You are reviewing a carousel before it is posted.",
    "",
    ...numbered,
    "",
    `Keep every slide in its place: the same number of slides, in the same order${hasPictures ? ", because each picture belongs to its position" : ""}. Keep every fact, number and name that is in the copy now, and never add one that is not — you may only reword, reorder words within a slide, cut, or re-aim a slide${hasPictures ? " at what its picture shows" : ""}. The one addition allowed is the invitation to try CoLateral on the last slide.`,
    "",
    "The deck:",
    JSON.stringify(deck, null, 2),
    "",
    hasPictures
      ? 'Respond with ONLY valid JSON: {"slides":[{"heading":"...","body":"...","picture":"keep"}],"notes":"one sentence on what you changed"}'
      : 'Respond with ONLY valid JSON: {"slides":[{"heading":"...","body":"..."}],"notes":"one sentence on what you changed"}'
  ].join("\n");
}

export function parseReview(text: string, expected: number): StoryReview | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { slides?: Array<Record<string, unknown>>; notes?: unknown };
    if (!Array.isArray(parsed.slides) || parsed.slides.length !== expected) return null;
    const slides = parsed.slides.map((slide) => ({
      heading: typeof slide.heading === "string" ? slide.heading.trim() : "",
      body: typeof slide.body === "string" ? slide.body.trim() : "",
      picture: slide.picture === "drop" ? ("drop" as const) : ("keep" as const)
    }));
    if (slides.some((slide) => !slide.heading && !slide.body)) return null;
    return { slides, notes: typeof parsed.notes === "string" ? parsed.notes.trim() : "" };
  } catch {
    return null;
  }
}

export function applyReview(carousel: Carousel, review: StoryReview): Carousel {
  const slides = carousel.slides.map((slide, index) => {
    const verdict = review.slides[index];
    if (!verdict) return slide;
    const next: CarouselSlide = {
      ...slide,
      heading: verdict.heading ? titleCaseHeading(verdict.heading) : slide.heading,
      body: verdict.body || slide.body
    };
    const backdrop = backdropOf(slide);
    if (verdict.picture !== "drop" || !backdrop) return next;
    const layers = (slide.layers ?? []).filter((layer) => layer !== backdrop);
    return {
      ...next,
      layers: layers.length ? layers : undefined,
      scrim: undefined,
      textBand: undefined,
      headingColor: slide.headingColor === BACKDROP_SLIDE_LAYOUT.headingColor ? undefined : slide.headingColor,
      bodyColor: slide.bodyColor === BACKDROP_SLIDE_LAYOUT.bodyColor ? undefined : slide.bodyColor
    };
  });
  return { ...carousel, slides };
}

export async function reviewCarouselStory(input: {
  carousel: Carousel;
  system: string;
}): Promise<{ carousel: Carousel; note: string | null }> {
  const { carousel } = input;
  if (!claudeCodeEnabled() || carousel.slides.length < 2) return { carousel, note: null };

  const dir = path.join(os.tmpdir(), "colateral-carousel-review", carousel.id);
  await mkdir(dir, { recursive: true });
  try {
    const pictures = await Promise.all(
      carousel.slides.map(async (slide, index) => {
        const id = parseCarouselImageId(backdropOf(slide)?.src ?? "");
        const source = id ? carouselImagePath(id) : null;
        if (!id || !source) return null;
        const name = `slide-${String(index + 1).padStart(2, "0")}${path.extname(id) || ".jpg"}`;
        const ok = await copyFile(source, path.join(dir, name)).then(
          () => true,
          () => false
        );
        return ok ? path.join(dir, name) : null;
      })
    );
    const text = await runClaudeCode({
      system: input.system,
      prompt: buildReviewPrompt(carousel.slides, pictures),
      readDir: pictures.some(Boolean) ? dir : undefined,
      timeoutMs: 10 * 60 * 1000
    });
    const review = text ? parseReview(text, carousel.slides.length) : null;
    if (!review) return { carousel, note: "The story review did not come back, so the deck is as first written." };
    const dropped = review.slides.filter((slide, index) => slide.picture === "drop" && pictures[index]).length;
    const note = dropped
      ? `Story review took the picture off ${dropped} slide${dropped === 1 ? "" : "s"} that did not match ${dropped === 1 ? "its" : "their"} words.`
      : null;
    return { carousel: applyReview(carousel, review), note };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
