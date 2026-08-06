import { falConfigured } from "@/lib/music/fal";

/**
 * Does this still actually show what the slide says?
 *
 * Anchoring a slide to the second its copy was drawn from gets the right
 * MINUTE, and that alone took the fit between picture and words from 4.8/10 to
 * around 7.8/10 on a real stream. What it cannot do is see: it can't tell that
 * the frame it landed on is a crossfade with two windows smeared together, that
 * he blinked, or that "the transcript is right there" is sitting on a music
 * generator. Every failure left is a question about what is IN the picture, so
 * the picture has to be looked at.
 *
 * That look costs money, so it is optional and fails open: with no FAL_KEY the
 * best-looking frame near the anchor is used exactly as before. fal is chosen
 * because it is the one vision-capable credential this app already has — the
 * free text gateway refuses images outright.
 */

const VISION_ENDPOINT = "https://fal.run/fal-ai/any-llm/vision";
/**
 * Chosen by calibration, not by price. Scored against five frames a careful
 * human-equivalent reviewer had already rated, the cheaper tiers waved through
 * the bad ones — Gemini Flash Lite gave 8, 10 and 8 to three stills that
 * deserved 4, 5 and 4, because a terminal full of unrelated work still looks
 * like "the right kind of screen". Haiku separated them cleanly (10 and 8 for
 * the good frames, 3 for all three bad ones), and a gate that passes everything
 * is worse than no gate: it costs money and buys false confidence.
 * `scripts/calibrate-relevance.ts` re-runs that comparison.
 */
const VISION_MODEL = "anthropic/claude-haiku-4.5";

/** A still this far below the mark is not worth putting behind the words. */
export const MIN_FRAME_RELEVANCE = 8;

/** How many candidates per slide are worth paying to look at. */
export const RATED_CANDIDATES = 3;

const REQUEST_TIMEOUT_MS = 30_000;

export function frameRelevanceConfigured(): boolean {
  return falConfigured();
}

/** The question asked about one still. Pure, for tests. */
export function buildRelevancePrompt(slide: { heading?: string; body?: string }): string {
  const copy = [slide.heading?.trim(), slide.body?.trim()].filter(Boolean).join(" — ");
  return [
    "This still will be used as the background of a social media slide, with the words below laid over it.",
    "",
    `Slide words: "${copy}"`,
    "",
    "Work through it in this order and answer in exactly this format:",
    "SEE: <what is actually in the picture, under 15 words — name the application or the subject>",
    "SHOWS: <the thing the words claim you are LOOKING AT, or NOTHING>",
    "FOUND: <yes or no — is that thing visible in the picture>",
    "SCORE: <1-10>",
    "",
    "SHOWS is NOTHING unless the words point at the picture. Words that state a plan, a date, a goal, an opinion, a piece of advice, a feeling or an invitation to follow are the speaker talking, even when they mention a product by name — \"CoLateral launches August 1st\" is a plan, not a claim about what is on screen. Only words like \"here is the terminal\", \"the transcript is right there\", \"this is Warp\" or a description of something being used, built or fixed are pointing at the picture.",
    "",
    "Scoring, strictly:",
    "- SHOWS something and FOUND yes → 9 or 10.",
    "- SHOWS something and FOUND no → AT MOST 4, however related the picture looks. A terminal full of unrelated work is NOT evidence for a slide about transcripts, and another product's window is not evidence for this one. Do not award a pass for being the same kind of screen.",
    "- SHOWS NOTHING → judge ONLY the picture's quality as a backdrop. A sharp, well-lit shot of the speaker, or any clean readable screen from his desk, is 8 or 9. Do not mark it down for not illustrating the words.",
    "- Whatever the words, score 2 if the picture is unusable in itself: a fade, a crossfade with two windows smeared together, a blank or half-loaded screen, heavy motion blur, eyes shut mid-blink, or a hand across the face."
  ].join("\n");
}

/**
 * Reads the rating out of the reply, or null when it did not give one. Takes
 * the SCORE line when the model followed the format, and the last number
 * otherwise — the reply is a worked answer, so the first number in it is
 * usually part of the description rather than the verdict.
 */
export function parseRelevance(text: string): number | null {
  const line = text.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
  const numbers = line ? [line[1]] : text.match(/\d+(?:\.\d+)?/g);
  if (!numbers?.length) return null;
  const score = Number(numbers[numbers.length - 1]);
  if (!Number.isFinite(score)) return null;
  return Math.min(10, Math.max(1, score));
}

/**
 * Rates one still against one slide's words. Never throws: any failure comes
 * back as null and the caller falls back to judging the frame on its looks.
 */
export async function rateFrame(input: {
  slide: { heading?: string; body?: string };
  jpeg: Uint8Array;
}): Promise<number | null> {
  if (!frameRelevanceConfigured()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(VISION_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt: buildRelevancePrompt(input.slide),
        image_url: `data:image/jpeg;base64,${Buffer.from(input.jpeg).toString("base64")}`
      }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { output?: unknown };
    return typeof data.output === "string" ? parseRelevance(data.output) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
