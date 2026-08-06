/**
 * Where in a recording each slide's copy came from.
 *
 * A carousel written from a stream is illustrated with stills from that stream,
 * and a still is only worth having if it shows the thing the slide is talking
 * about. That means the picture has to follow the WORDS, not the slide number:
 * spreading eight stills evenly across seventy minutes puts the "agentic dev
 * environment" slide on whatever happened to be on screen at minute 32.
 *
 * So the model is given a timestamped transcript and asked which second each
 * slide is drawn from, and this module turns that answer into the seconds the
 * frames are cut at — falling back to matching the slide's own words against
 * the transcript when the model leaves it out, and to an even spread when even
 * that finds nothing.
 *
 * Everything here is pure and tested; the ffmpeg half lives in videoFrames.ts.
 */

export type TranscriptSegment = { start: number; end: number; text: string };

/** How much transcript the model is shown. Enough to cover a long stream. */
export const DIGEST_MAX_CHARS = 24000;

/** Two slides closer together than this would be cut from the same shot. */
export const MIN_ANCHOR_GAP_SEC = 25;

/** How many segments are read together when matching a slide's words. */
const MATCH_WINDOW = 6;
/** Below this a "match" is one common word and means nothing. */
const MIN_MATCH_SCORE = 1.5;

/**
 * Word matching is the FALLBACK and cannot be more than that. Slide headings
 * are punchy rewrites, not quotes: measured over a real deck, six of eight
 * slides share no distinctive word with the transcript at all. So it catches a
 * slide the model left unstamped, and it is never used to second-guess a
 * stamped one — it would almost always have nothing to say, and the times it
 * did would be the times it had latched onto one incidental word.
 */

export function timecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The transcript as the model sees it: every line stamped with the minute it
 * was said, thinned evenly when the recording is long.
 *
 * Thinned, never truncated — a seventy-minute stream is 50k characters, and
 * cutting it to the first 9k gave the model only the opening to write eight
 * slides about while the stills came from the whole thing. Dropping every other
 * line keeps the shape of the whole recording.
 */
export function transcriptDigest(segments: TranscriptSegment[], maxChars = DIGEST_MAX_CHARS): string {
  const usable = segments.filter((segment) => segment.text.trim());
  if (!usable.length) return "";
  const line = (segment: TranscriptSegment) => `[${timecode(segment.start)}] ${segment.text.trim()}`;
  const full = usable.map(line);
  const total = full.reduce((sum, entry) => sum + entry.length + 1, 0);
  if (total <= maxChars) return full.join("\n");
  const step = Math.ceil(total / maxChars);
  return usable.filter((_, index) => index % step === 0).map(line).join("\n");
}

/** A number the model gave for "which second is this slide about", or null. */
export function parseAtSeconds(value: unknown, durationSec: number): number | null {
  if (value === null || value === undefined) return null;
  // A missing or wordy answer must not read as second zero — "" parses to 0,
  // which would silently anchor every unstamped slide to the title card.
  const digits = typeof value === "number" ? String(value) : String(value).replace(/[^\d.]/g, "");
  if (!/\d/.test(digits)) return null;
  const seconds = Number(digits);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (durationSec > 0 && seconds > durationSec) return null;
  return Number(seconds.toFixed(2));
}

const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "been", "before", "being", "between", "could",
  "doing", "during", "every", "from", "gonna", "have", "having", "here", "into", "just", "like",
  "more", "most", "much", "only", "other", "over", "really", "right", "same", "some", "such",
  "than", "that", "their", "them", "then", "there", "these", "they", "thing", "things", "this",
  "those", "through", "under", "very", "want", "well", "were", "what", "when", "where", "which",
  "while", "will", "with", "would", "your", "yeah", "know", "actually", "basically", "literally",
  "something", "everything", "little", "still", "okay", "come", "back", "make", "made", "look"
]);

/** Content words of a slide, lower-cased and de-duplicated. */
export function slideTerms(text: string): string[] {
  const terms = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  return [...new Set(terms)];
}

/**
 * The second in the recording whose words best match a slide's copy, or null
 * when nothing in the transcript looks like it.
 *
 * Rare words carry the match: "colateral" or "terminal" pins a slide to one
 * part of a stream, "build" appears in half of it, so a term is weighted by how
 * few windows contain it.
 */
export function matchSegmentTime(text: string, segments: TranscriptSegment[]): number | null {
  return matchSegment(text, segments)?.seconds ?? null;
}

/** The best-matching moment and how strong the match was. */
export function matchSegment(
  text: string,
  segments: TranscriptSegment[]
): { seconds: number; score: number } | null {
  const terms = slideTerms(text);
  if (!terms.length || !segments.length) return null;

  const windows: Array<{ start: number; end: number; words: Set<string> }> = [];
  for (let index = 0; index < segments.length; index += MATCH_WINDOW) {
    const group = segments.slice(index, index + MATCH_WINDOW);
    if (!group.length) continue;
    windows.push({
      start: group[0].start,
      end: group[group.length - 1].end,
      words: new Set(slideTerms(group.map((segment) => segment.text).join(" ")))
    });
  }
  if (!windows.length) return null;

  const weight = new Map<string, number>();
  for (const term of terms) {
    const seen = windows.reduce((count, window) => count + (window.words.has(term) ? 1 : 0), 0);
    weight.set(term, seen ? 1 / Math.log2(2 + seen) : 0);
  }

  let best: { score: number; seconds: number } | null = null;
  for (const window of windows) {
    let score = 0;
    for (const term of terms) if (window.words.has(term)) score += weight.get(term) ?? 0;
    if (!best || score > best.score) best = { score, seconds: (window.start + window.end) / 2 };
  }
  if (!best || best.score < MIN_MATCH_SCORE) return null;
  return { seconds: Number(best.seconds.toFixed(2)), score: Number(best.score.toFixed(3)) };
}

/**
 * Nudges anchors apart so two slides never get the same shot, keeping them in
 * the order they were given. Only ever moves a time later, and never past the
 * end of the recording — a deck whose last slides all land in the final minute
 * is still better than two identical stills.
 */
export function separateAnchors(times: number[], durationSec: number, minGap = MIN_ANCHOR_GAP_SEC): number[] {
  const last = Math.max(0, durationSec - 1);
  let previous = -Infinity;
  return times.map((time) => {
    const seconds = Math.min(last, Math.max(0, previous + minGap > time ? previous + minGap : time));
    previous = seconds;
    return Number(seconds.toFixed(2));
  });
}

/**
 * The point in the video each slide is illustrated from when nothing better is
 * known: evenly spread, with the very start and end left out — a stream opens
 * on a title card and ends on a goodbye, and neither is what a slide is about.
 */
export function spreadTargets(durationSec: number, count: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || count < 1) return [];
  const start = durationSec * 0.05;
  const end = durationSec * 0.95;
  const span = Math.max(0, end - start);
  return Array.from({ length: count }, (_, index) => Number((start + (span * (index + 0.5)) / count).toFixed(2)));
}

export type SlideAnchor = { seconds: number; from: "model" | "transcript" | "spread" };

/**
 * One second per slide, and where it came from. The model's own answer is
 * trusted first because it read the words in context; a slide it skipped is
 * matched on its wording; a slide neither can place falls back to its position
 * in the deck.
 */
export function anchorSlides(input: {
  slides: Array<{ heading?: string; body?: string; atSeconds?: number | null }>;
  segments: TranscriptSegment[];
  durationSec: number;
}): SlideAnchor[] {
  const spread = spreadTargets(input.durationSec, input.slides.length);
  const anchors = input.slides.map((slide, index): SlideAnchor => {
    const words = `${slide.heading ?? ""} ${slide.body ?? ""}`;
    const fromModel = parseAtSeconds(slide.atSeconds, input.durationSec);
    if (fromModel !== null) return { seconds: fromModel, from: "model" };
    const matched = matchSegmentTime(words, input.segments);
    if (matched !== null) return { seconds: matched, from: "transcript" };
    return { seconds: spread[index] ?? 0, from: "spread" };
  });
  const separated = separateAnchors(
    anchors.map((anchor) => anchor.seconds),
    input.durationSec
  );
  return anchors.map((anchor, index) => ({ ...anchor, seconds: separated[index] }));
}
