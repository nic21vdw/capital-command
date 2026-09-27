import { aiConfigured, runAi } from "@/lib/ai";
import { parseAtSeconds, timecode, transcriptDigest, type TranscriptSegment } from "@/lib/carousels/anchors";
import { carouselAngle, clampBatchCount, hookProblem, MAX_SLIDES, resolveSlideCount, titleCaseHeading } from "@/lib/carousels/deck";
import { attachSlideBackdrops, attachSlideImages, type CarouselImage } from "@/lib/carousels/imageSlides";
import { deskFramesForDeck } from "@/lib/carousels/bRoll";
import { footageKind } from "@/lib/carousels/footage";
import { framesForSlides } from "@/lib/carousels/videoFrames";
import { CHANNEL_CONTEXT, CHANNEL_KEYWORDS } from "@/lib/clipping/keywords";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import { carouselSchema } from "@/lib/storage/schemas";
import type { Carousel, CarouselBatch, CarouselSlide } from "@/types/domain";
import { reviewCarouselStory } from "@/lib/carousels/storyReview";

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

/**
 * Where a slide's picture goes. An uploaded photo is the subject and takes the
 * top of the slide; a still lifted out of the video is the setting and goes
 * behind the copy.
 */
export type CarouselImageMode = "photo" | "backdrop";

/**
 * A slide as the model wrote it, before it is given an id and a picture.
 * `atSeconds` is the moment in the recording the copy was drawn from — the
 * second its still is cut at. Null for sources that are not a recording.
 */
export type SlideDraft = Pick<CarouselSlide, "heading" | "body"> & { atSeconds?: number | null };

export function carouselGenerationConfigured() {
  return aiConfigured();
}

export const CAROUSEL_SYSTEM_PROMPT = `You write carousel copy for this channel. ${CHANNEL_CONTEXT} The same carousel is posted across Instagram, Facebook, and TikTok, so keep the copy platform-neutral - no "Instagram" / "IG"-only references, and nothing that only makes sense on one network. Channel keywords: ${CHANNEL_KEYWORDS.join(", ")}.

A carousel is ONE STORY told a slide at a time, and every slide exists to earn the next swipe. A reader who was not there should finish it knowing what happened, why it mattered, and what happens next.

Find the story before you write a slide. A session is hours of material and most of it is not the story. Look for these, in this order, and build on the strongest one you find:
- A GOAL with a STAKE: something I needed to happen tonight and what it would cost if it did not (money, a launch, a promise to chat, hours already sunk).
- An OBSTACLE that fought back: the error, the stall, the wrong turn, the thing that broke at the worst moment. The bigger it is, the better the story — do not sand it down.
- A TURN: the moment something changed — an insight, a new approach, an agent finding what I missed, a number moving. Stories are made of turns, not of events.
- An OUTCOME and what it MEANS: shipped or not, the number it landed on, what I now know that I did not at the start.
Then write the whole story as a single sentence of the form "I needed X, but Y, so Z, which meant W" — that is the through-line, and it goes in "story.throughLine". Every slide advances it. Moments that do not serve it are left out, however good.

Shape the deck as an arc:
- HOOK -> SETUP -> TURNS -> PAYOFF -> CTA. The hook states the stake so the reader needs the answer. The setup says what I was attempting and why it mattered. Each turn changes the situation. The payoff resolves the hook's question. The CTA says what happens next.
- Chain slides with BUT and SO, never AND THEN. Each slide is a consequence of the one before it or a reversal of it. If the only link between two slides is that one happened later, find the cause-and-effect or cut one.
- Every slide but the last ends on a SWIPE BRIDGE: its last sentence leaves something open that the next slide answers — a catch ("But the real problem was upstream."), a question ("So why was it still stuck?"), a reversal about to land, a number about to be revealed. Keep bridges short, concrete and different from each other; never "keep reading", "swipe to find out", "you won't believe" or any line that names the swipe.
- Hold the payoff back. The hook's question is resolved on the payoff slide and not before; the strongest number or result is revealed there, not on slide 2.
- Read the finished deck back as a stranger swiping it with their thumb. Score every slide 1-10 for "would I swipe to the next one?" and rewrite any slide under 9. If two slides could swap places, if one does not follow from the one before, or if the story would survive a slide being removed, rewrite until each slide is load-bearing.

CoLateral is the product this whole channel exists to build, so every deck plugs it — honestly and specifically:
- When the session shows CoLateral — the feature being built, the part that broke, what it let me do — at least one middle slide is about that, naming the actual thing and why it matters to someone who builds with AI. Never generic praise ("CoLateral is amazing"), never a feature the session does not show, and never a slide that only recites what CoLateral is: if the session does not show it, no middle slide is forced, and the CTA carries the plug.
- The CTA slide names CoLateral and invites the reader to try it, alongside the reason to follow for the next session. Do not write the web address — every slide already shows colateralai.com, and the last slide carries a "Try it at colateralai.com" button under the copy. Keep the CTA body under 160 characters so the button has room.

Carousel rules:
- Slide 1 is the HOOK and it is the slide the whole deck lives or dies on. It must state a real stake from the session — a number, a thing that broke, a decision, a result — in max 12 words, with "body" empty or one short kicker that deepens the curiosity. Take it from the STRONGEST moment anywhere in the session, not from whatever was said first. It does not have to be a sentence he said; write the hook the session earned. A good hook makes a promise the deck keeps.
- BANNED as a hook, always: a greeting ("how are we tonight", "what's up chat"), a mic or audio check, "who wants it", "let's go", a bare day counter, or any opener that would fit any other episode unchanged.
- Middle slides each carry ONE beat of the story: "heading" max 8 words, "body" 1-3 short sentences (max 200 characters) that deliver — not tease — the beat, then point at the next one.
- Every slide must name something specific: a number, a tool, an error, a feature, a person, or a decision. If a slide could be dropped into a different episode without changing a word, it is filler — pick a different moment.
- Stream logistics are not story beats. No slide about OBS, a terminal restart, a mic test, the internet connection, scene setup, or "let me pull that up" — unless it changed what got built, and then the slide says what it cost.
- "$0 revenue" is not the point of a deck. Use at most one revenue line and at most one "Day N" line per deck, and only where that number IS the idea of that slide.
- The body must add what the heading does not already say. Never leave a body empty (except an optional empty hook body), never restate the heading in other words.
- At least two thirds of the slides must be about the build — what was made, what broke, what was fixed, what was learned in the code. Mindset, health and lifestyle material is capped at two slides, and only where it ties back to the work.
- No two slides may make the same point.
- The last slide is the CTA: close the story's loop in one line, name what specifically comes next — the next feature, the next session's topic, the cliffhanger from this one — as the reason to follow, and invite the reader to try CoLateral. "Follow for more" on its own is not a valid slide.
- KEYWORDS ARE BOLD. Wrap the words a skimming reader must not miss in **double asterisks**: the number, the tool or product name, the result, the thing that broke. One bolded phrase (1-3 words) in a heading at most; one to three in a body. Never bold a whole sentence, never bold filler words, and never nest or leave a ** unclosed. Bold is for the eye that only reads the bold — reading only the bold words across the deck should still tell the story.
- The source is speech-to-text and it garbles names. Correct obvious mishearings against the real ones (Claude, Claude Code, Opus, Codex, Warp, Cursor, Grok, CoLateral, Streamer.bot, Remotion, Vandewetering). If you cannot work out what a garbled name was, write the slide without it or pick another moment — never publish the garble.
- Never use these phrases or their variants: "building in public", "one vibe at a time", "big things coming", "this is only the beginning", "the grind", "follow the journey", "let's go", "game changer", "buckle up".
- Write in Nic's own voice, first person: "I", "my", "we" for him and chat together. Never "he", "Nic" or "the creator" — the slides are posted from his account.
- Plain, confident, human language — short words, active verbs, the way a sharp friend would retell the night. No hashtags on slides, no invented facts or numbers.
- Emojis are optional seasoning: at most one per slide, only where it adds meaning (🚀 ship, 🐛 bug, 💸 money, 🤖 AI agent, ⚠️ problem, ✅ fixed), and never in place of a word. Most slides read better with none.

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

const STORY_JSON =
  '{"story":{"goal":"...","obstacle":"...","turn":"...","outcome":"...","throughLine":"I needed X, but Y, so Z, which meant W"}';

/** Builds the carousel prompt. Pure, for tests. */
export function buildCarouselPrompt(input: {
  title: string;
  sourceText: string;
  slideCount: number;
  /** The brief for this batch, when several are being written from one source. */
  angle?: string;
  batchIndex?: number;
  batchTotal?: number;
  /** How many leading slides already carry a picture. */
  imageCount?: number;
  /** Whether those pictures sit above the copy or behind it. */
  imageMode?: CarouselImageMode;
  /** What the photos show / how they should be used, in the user's words. */
  imageNotes?: string;
  /**
   * The recording this is written from, stamped. Present only when the deck
   * will be illustrated with stills from it — the model is then asked which
   * second each slide is drawn from, and that answer is where the still is cut.
   */
  transcript?: TranscriptSegment[];
}): string {
  const digest = input.transcript?.length ? transcriptDigest(input.transcript) : "";
  const lastStamp = timecode(input.transcript?.at(-1)?.end ?? 0);
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
  if (digest) {
    lines.push(
      "EVERY slide will sit on a still cut from this recording at the second you name in \"atSeconds\", so that second is what the reader SEES behind the words — and a slide whose words do not match its moment reads as a mistake. The transcript below is stamped [mm:ss].",
      "- Write each slide about ONE moment that is really in the recording, and set \"atSeconds\" to the second it was happening (mm:ss -> seconds, so [12:30] is 750).",
      "- The words and the moment must be the same thing. Say what was being done, shown or worked out AT that second — not a general claim about the product, the channel or the journey. \"Claude runs inside the terminal\" belongs on the second the terminal is being used; it does not belong on a second where he is only talking about the plan.",
      "- This includes the hook and the last slide. A closing slide still has to be a real moment — what he was doing as he wrapped up, what shipped, what is next — with its own atSeconds, and the invitation to follow is one short line on top of it.",
      "- Pick moments a viewer could recognise: a tool open and being used, a thing being built or fixed, a result appearing, a number going up, something going wrong. Skip stretches where nothing is happening, and skip a screen that has just been opened and is still empty — pick the second it has something on it.",
      "- NEVER promise a picture. No \"here's a preview\", no \"this is X\", no \"look at this\" unless the transcript at that exact second has him opening, showing or pointing at that thing. A slide that announces something the still does not contain is worse than a plain one — write what he was DOING at that second instead.",
      "- A recording often covers more than one project. Name the one he is actually in at that second and never move a feature from one to another: if the thing on screen belongs to a different project than the one you are pitching, either say the right name or pick a different moment.",
      `- Use the WHOLE recording. It runs to [${lastStamp}]. Walk the deck through it in the order it happened, spreading the moments across the full length — roughly a third of the slides from the first third, a third from the middle, a third from the last third, and the closing slide from near the end. Do not write the whole deck out of the opening minutes.`,
      "- Never describe what is visible in a still; you have not seen them.",
      ""
    );
  }
  if (input.imageCount && input.imageCount > 0) {
    const plural = input.imageCount === 1 ? "" : "s";
    if (input.imageMode === "backdrop") {
      lines.push(
        `The first ${input.imageCount} slide${plural} sit${input.imageCount === 1 ? "s" : ""} on a still taken from the video itself, in order: slide 1 shows an early moment, each following slide a later one. Write the deck so it walks through the video in the order it happened — the copy on a slide should be about roughly that part of it. Never describe what is visible in a still; you have not seen them.`,
        ""
      );
    } else {
      lines.push(
        `The first ${input.imageCount} slide${plural} already carr${input.imageCount === 1 ? "ies" : "y"} a supplied photo across the top, in the order listed below. Write each of those slides as the caption for its own photo — the copy and the photo have to make sense together — and never describe a photo that was not described to you.`,
        ""
      );
    }
  }
  if (input.imageNotes?.trim()) {
    lines.push("The photos, in order, and how they should be used:", input.imageNotes.trim().slice(0, 2000), "");
  }
  lines.push(
    "Content:",
    digest || input.sourceText.slice(0, 9000),
    "",
    digest
      ? `Respond with ONLY valid JSON, the story first: ${STORY_JSON},"title":"short internal name for this carousel","slides":[{"heading":"...","body":"...","atSeconds":0}]}`
      : `Respond with ONLY valid JSON, the story first: ${STORY_JSON},"title":"short internal name for this carousel","slides":[{"heading":"...","body":"..."}]}`
  );
  return lines.join("\n");
}

/** Parses slides out of the model reply. */
export function parseCarousel(text: string): { title: string; slides: SlideDraft[] } | null {
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
        // Set as a headline here rather than at paint time, so the words in the
        // editor are the words on the slide.
        heading: typeof slide.heading === "string" ? titleCaseHeading(slide.heading.trim()) : "",
        body: typeof slide.body === "string" ? slide.body.trim() : "",
        atSeconds: parseAtSeconds(slide.atSeconds, 0)
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
  slides: SlideDraft[];
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
  slides: SlideDraft[];
  sourceType: Carousel["sourceType"];
  sourceId?: string;
  images?: CarouselImage[];
  imageMode?: CarouselImageMode;
  batch?: CarouselBatch;
}): Carousel {
  const slides: CarouselSlide[] = input.slides.map((slide) => ({
    id: `slide-${crypto.randomUUID().slice(0, 8)}`,
    heading: slide.heading,
    body: slide.body
  }));
  return carouselSchema.parse({
    id: `carousel-${crypto.randomUUID()}`,
    title: input.title,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    slides: input.images?.length
      ? input.imageMode === "backdrop"
        ? attachSlideBackdrops(slides, input.images)
        : attachSlideImages(slides, input.images)
      : slides,
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
function padForImages(slides: SlideDraft[], imageCount: number): { slides: SlideDraft[]; missing: number } {
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

/**
 * The written deck plus the drafts it came from. The drafts carry `atSeconds`,
 * which is what a caller illustrating from the recording cuts its stills at —
 * the record itself keeps only what a slide is, not where it came from.
 */
export type CarouselGeneration = {
  carousel: Carousel | null;
  drafts: SlideDraft[];
  reason: string | null;
  /**
   * How many drafts were thrown back for opening on a weak hook. Reported
   * rather than swallowed: a run that needed three goes at slide 1 is a run
   * worth looking at, and the count is the only sign of it once the deck that
   * finally passed is the one on screen.
   */
  hookRetries?: number;
};

export type CarouselGenerationInput = {
  title: string;
  sourceText: string;
  slideCount: number;
  sourceType: Carousel["sourceType"];
  sourceId?: string;
  /** The brief for this batch — see CAROUSEL_ANGLES. */
  angle?: string;
  /** Pictures to sit on the leading slides, in order. */
  images?: CarouselImage[];
  /**
   * How those pictures are laid in. "photo" puts an uploaded photo across the
   * top with the copy underneath; "backdrop" lays a still from the video the
   * copy was written from behind the whole slide, under a veil.
   */
  imageMode?: CarouselImageMode;
  /** What those photos show, in the user's words. */
  imageNotes?: string;
  /**
   * The recording, stamped, when the deck will be illustrated from it. The
   * model then says which second each slide is drawn from and the caller cuts
   * the stills there — see `framesForSlides`.
   */
  transcript?: TranscriptSegment[];
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
): Promise<CarouselGeneration> {
  const images = input.images ?? [];
  const slideCount = resolveSlideCount({ slideCount: input.slideCount, imageCount: images.length });
  const give = (reason: string): CarouselGeneration => {
    if (input.requireModel) return { carousel: null, drafts: [], reason };
    const fallback = fallbackCarousel({ ...input, slideCount });
    return {
      carousel: toCarouselRecord({
        ...fallback,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        images,
        imageMode: input.imageMode,
        batch: input.batch
      }),
      drafts: fallback.slides,
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
    imageMode: input.imageMode,
    imageNotes: input.imageNotes,
    transcript: input.transcript
  });

  let last = "The model was unavailable or declined.";
  let hookRetries = 0;
  for (let attempt = 1; attempt <= CAROUSEL_ATTEMPTS; attempt += 1) {
    try {
      const result = await runAi({
        maxTokens: 6000,
        writer: "claude-code",
        system: CAROUSEL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }]
      });
      if (!result || result.refused) {
        last = "The model was unavailable or declined.";
      } else {
        const parsed = parseCarousel(result.text);
        const weakHook = parsed ? hookProblem(parsed.slides[0]) : null;
        if (parsed && weakHook && attempt < CAROUSEL_ATTEMPTS) {
          // Thrown back rather than published. The deck behind it may be fine,
          // but slide 1 is the only one most people ever see.
          last = `The deck came back with a weak opening slide — ${weakHook}.`;
          hookRetries += 1;
          continue;
        }
        if (parsed) {
          const padded = padForImages(parsed.slides, images.length);
          const record = toCarouselRecord({
            title: parsed.title === "Carousel" ? input.title : parsed.title,
            slides: padded.slides,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            images,
            imageMode: input.imageMode,
            batch: input.batch
          });
          return {
            carousel: input.transcript?.length ? record : (await reviewStory(record)).carousel,
            drafts: padded.slides,
            hookRetries,
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
 * Lays a still from the recording behind each slide of a deck that has already
 * been written. Illustrating happens AFTER the copy, never before: the still is
 * cut at the second the model says that slide is about, so a slide about the
 * agent terminal shows the agent terminal.
 *
 * A recording that can't be read gives the deck back untouched with a note —
 * copy with no pictures is still a carousel.
 */
export async function illustrateFromRecording(input: {
  carousel: Carousel;
  drafts: SlideDraft[];
  sourceId: string;
  transcript: TranscriptSegment[];
}): Promise<{ carousel: Carousel; note: string | null }> {
  // A phone-shot talking-head recording is illustrated from the desk instead of
  // from itself — see bRoll.ts. Anchoring is skipped with it: there is nothing
  // in the borrowed footage for a slide's own second to point at.
  const talkingHead = (await footageKind(input.sourceId).catch(() => "desk")) === "talking-head";
  const frames = talkingHead
    ? await deskFramesForDeck({ excludeSourceId: input.sourceId, slideCount: input.carousel.slides.length }).catch(() => null)
    : await framesForSlides({
        sourceId: input.sourceId,
        slides: input.drafts,
        segments: input.transcript
      }).catch(() => null);
  const illustrated = frames?.images.some(Boolean)
    ? { ...input.carousel, slides: attachSlideBackdrops(input.carousel.slides, frames.images) }
    : input.carousel;
  const reviewed = await reviewStory(illustrated);
  return {
    carousel: reviewed.carousel,
    note: [frames?.note, reviewed.note].filter(Boolean).join(" ") || null
  };
}

function reviewStory(carousel: Carousel): Promise<{ carousel: Carousel; note: string | null }> {
  return reviewCarouselStory({ carousel, system: CAROUSEL_SYSTEM_PROMPT }).catch(() => ({ carousel, note: null }));
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
  input: Omit<CarouselGenerationInput, "angle" | "batch"> & {
    batchCount?: number;
    /** Illustrate each batch with stills from this recording, per slide. */
    recordingId?: string;
  }
): Promise<{ carousels: Carousel[]; reason: string | null }> {
  const total = clampBatchCount(input.batchCount);
  const groupId = crypto.randomUUID().slice(0, 8);

  const results = await Promise.all(
    Array.from({ length: total }, async (_, index) => {
      const angle = carouselAngle(index);
      const written = await generateCarousel({
        ...input,
        // A single carousel is asked for exactly as it always was — no angle, no
        // batch record — so the Stream Pipeline's slides do not change shape.
        angle: total > 1 ? angle.instruction : undefined,
        batch: total > 1 ? { groupId, index: index + 1, total, angle: angle.label } : undefined
      });
      // Each batch is written on its own angle, so each is about its own
      // moments and gets its own stills — one shared set would put the same
      // eight pictures behind three different stories.
      if (!written.carousel || !input.transcript?.length) return written;
      if (!input.recordingId) {
        const reviewed = await reviewStory(written.carousel);
        return { ...written, carousel: reviewed.carousel };
      }
      const illustrated = await illustrateFromRecording({
        carousel: written.carousel,
        drafts: written.drafts,
        sourceId: input.recordingId,
        transcript: input.transcript
      });
      return {
        ...written,
        carousel: illustrated.carousel,
        reason: [written.reason, illustrated.note].filter(Boolean).join(" ") || null
      };
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
