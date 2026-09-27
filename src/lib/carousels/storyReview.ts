import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeCodeEnabled, runClaudeCode } from "@/lib/ai/claudeCode";
import { titleCaseHeading } from "@/lib/carousels/deck";
import { attachHookBackdrop, BACKDROP_SLIDE_LAYOUT, type CarouselImage } from "@/lib/carousels/imageSlides";
import { carouselImagePath, parseCarouselImageId, saveCarouselImage } from "@/lib/carousels/uploads";
import type { Carousel, CarouselSlide, SlideLayer } from "@/types/domain";

export type ReviewedSlide = { heading: string; body: string; picture: "keep" | "drop" };
export type StoryReview = { slides: ReviewedSlide[]; notes: string; hookPicture: string | null; hookFocus: number };

type ImageLayer = Extract<SlideLayer, { type: "image" }>;

function backdropOf(slide: CarouselSlide): ImageLayer | null {
  const layer = (slide.layers ?? []).find((entry): entry is ImageLayer => entry.type === "image" && entry.fit === "frame");
  return layer ?? null;
}

export function buildReviewPrompt(slides: CarouselSlide[], pictures: Array<string | null>, hookCandidates: string[] = []): string {
  const hasPictures = pictures.some(Boolean);
  const choosingHook = hookCandidates.length > 0;
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
  const hookSteps = choosingHook
    ? [
        `Choose slide 1's picture. It is the thumbnail of the whole post: it fills the entire slide, cropped to a tall 4:5 window (about 55% of the frame's width) centred where you say, with the headline set in huge type over its lower half. Open every hook candidate below with the Read tool (${hookCandidates.join(", ")}), and the slide pictures too, and pick the ONE a stranger would stop scrolling for: a face with a big, readable reaction (shock, laughing, frustration, disbelief), a dramatic result on screen, something that makes them need the story. A full-camera shot of my face mid-reaction almost always beats a screen; a small webcam box in a corner does not count as a face. Put its file name in "hookPicture", and in "hookFocus" the horizontal centre of the subject as a fraction of the frame's width (0 is the left edge, 0.5 the middle, 1 the right edge), so the crop keeps the face whole. A dark, blurred, mid-transition or ordinary frame never wins; if nothing would stop a scroll, set "hookPicture" to "none".`,
        "Then make slide 1's words and that picture one moment: the headline should read as what that face or that screen is reacting to."
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
  const steps = [...hookSteps, ...pictureSteps, ...storySteps];
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
    `Respond with ONLY valid JSON: {${choosingHook ? '"hookPicture":"hook-01.jpg","hookFocus":0.5,' : ""}"slides":[{"heading":"...","body":"..."${hasPictures ? ',"picture":"keep"' : ""}}],"notes":"one sentence on what you changed"}`
  ].join("\n");
}

export function parseReview(text: string, expected: number): StoryReview | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as {
      slides?: Array<Record<string, unknown>>;
      notes?: unknown;
      hookPicture?: unknown;
      hookFocus?: unknown;
    };
    if (!Array.isArray(parsed.slides) || parsed.slides.length !== expected) return null;
    const slides = parsed.slides.map((slide) => ({
      heading: typeof slide.heading === "string" ? slide.heading.trim() : "",
      body: typeof slide.body === "string" ? slide.body.trim() : "",
      picture: slide.picture === "drop" ? ("drop" as const) : ("keep" as const)
    }));
    if (slides.some((slide) => !slide.heading && !slide.body)) return null;
    const hook = typeof parsed.hookPicture === "string" ? path.basename(parsed.hookPicture.trim()) : "";
    return {
      slides,
      notes: typeof parsed.notes === "string" ? parsed.notes.trim() : "",
      hookPicture: hook && hook.toLowerCase() !== "none" ? hook : null,
      hookFocus: typeof parsed.hookFocus === "number" && Number.isFinite(parsed.hookFocus) ? Math.min(1, Math.max(0, parsed.hookFocus)) : 0.5
    };
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

export function hookCropWindow(width: number, height: number, focus: number): { x: number; width: number } {
  const cropW = Math.min(width, Math.round(height * 0.8));
  const x = Math.round(Math.min(width - cropW, Math.max(0, focus * width - cropW / 2)));
  return { x, width: cropW };
}

async function cropForHook(image: CarouselImage, focus: number): Promise<CarouselImage> {
  const file = carouselImagePath(image.id);
  if (!file) return image;
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const still = await loadImage(await readFile(file));
  const window = hookCropWindow(still.width, still.height, focus);
  if (window.width >= still.width) return image;
  const canvas = createCanvas(window.width, still.height);
  canvas.getContext("2d").drawImage(still, window.x, 0, window.width, still.height, 0, 0, window.width, still.height);
  return saveCarouselImage(await canvas.encode("jpeg", 90), "image/jpeg", "hook.jpg");
}

export async function reviewCarouselStory(input: {
  carousel: Carousel;
  system: string;
  hookCandidates?: CarouselImage[];
}): Promise<{ carousel: Carousel; note: string | null }> {
  const { carousel } = input;
  const candidates = input.hookCandidates ?? [];
  const discard = async (keep: string | null) => {
    await Promise.all(
      candidates
        .filter((image) => image.url !== keep)
        .map(async (image) => {
          const file = carouselImagePath(image.id);
          if (file) await rm(file, { force: true }).catch(() => undefined);
        })
    );
  };
  if (!claudeCodeEnabled() || carousel.slides.length < 2) {
    await discard(null);
    return { carousel, note: null };
  }

  const dir = path.join(os.tmpdir(), "colateral-carousel-review", carousel.id);
  await mkdir(dir, { recursive: true });
  const place = async (id: string, name: string) => {
    const source = carouselImagePath(id);
    if (!source) return null;
    return copyFile(source, path.join(dir, name)).then(
      () => path.join(dir, name),
      () => null
    );
  };
  let kept: string | null = null;
  try {
    const pictures = await Promise.all(
      carousel.slides.map(async (slide, index) => {
        const id = parseCarouselImageId(backdropOf(slide)?.src ?? "");
        return id ? place(id, `slide-${String(index + 1).padStart(2, "0")}${path.extname(id) || ".jpg"}`) : null;
      })
    );
    const hookFiles = new Map<string, CarouselImage>();
    for (const [index, image] of candidates.entries()) {
      const name = `hook-${String(index + 1).padStart(2, "0")}${path.extname(image.id) || ".jpg"}`;
      if (await place(image.id, name)) hookFiles.set(name, image);
    }
    carousel.slides.forEach((slide, index) => {
      const layer = backdropOf(slide);
      const name = pictures[index] ? path.basename(pictures[index]!) : null;
      const id = parseCarouselImageId(layer?.src ?? "");
      if (layer && name && id) hookFiles.set(name, { id, url: layer.src });
    });

    const text = await runClaudeCode({
      system: input.system,
      prompt: buildReviewPrompt(carousel.slides, pictures, [...hookFiles.keys()].filter((name) => name.startsWith("hook-"))),
      readDir: pictures.some(Boolean) || hookFiles.size ? dir : undefined,
      timeoutMs: 10 * 60 * 1000
    });
    const review = text ? parseReview(text, carousel.slides.length) : null;
    if (!review) return { carousel, note: "The story review did not come back, so the deck is as first written." };
    const dropped = review.slides.filter((slide, index) => slide.picture === "drop" && pictures[index]).length;
    let reviewed = applyReview(carousel, review);
    const chosen = review.hookPicture ? hookFiles.get(review.hookPicture) : undefined;
    const hookImage = chosen ? await cropForHook(chosen, review.hookFocus).catch(() => chosen) : undefined;
    if (hookImage) {
      reviewed = { ...reviewed, slides: [attachHookBackdrop(reviewed.slides[0], hookImage), ...reviewed.slides.slice(1)] };
      kept = hookImage.url;
    }
    const note = dropped
      ? `Story review took the picture off ${dropped} slide${dropped === 1 ? "" : "s"} that did not match ${dropped === 1 ? "its" : "their"} words.`
      : null;
    return { carousel: reviewed, note };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    await discard(kept);
  }
}
