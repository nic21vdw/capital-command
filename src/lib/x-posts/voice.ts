/**
 * Making a generated post read like a person wrote it.
 *
 * Two things give a model away on Threads. The first is the em dash: models
 * reach for it constantly and almost nobody types one on a phone. The second is
 * that every sentence is immaculate. Real feeds are not.
 *
 * Asking the model nicely is not enough — it complies for a few posts and then
 * drifts back — so the dash removal here is deterministic and runs over every
 * post regardless of where the copy came from (model, idea library, or typed by
 * hand). The prompt asks as well; this is what makes it true.
 */

/** Deterministic 32-bit FNV-1a hash, so a given post always reads the same. */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Removes em and en dashes without flattening the sentence.
 *
 * A dash doing punctuation work becomes a comma, which is what someone typing
 * quickly would have written — including when that leaves a comma splice
 * ("it's not about speed, it's about judgment"). That splice is the point: it
 * reads like a person, where the dash reads like a model.
 *
 * Line breaks are preserved. Posts are written as several short lines, and
 * collapsing those into one paragraph would be a bigger tell than the dash.
 */
export function stripDashes(text: string): string {
  return (
    text
      // A dash opening a line is a bullet, not punctuation.
      .replace(/^([ \t]*)[—–][ \t]*/gm, "$1- ")
      // Ranges and score-like pairs keep their meaning with a hyphen.
      .replace(/(\d)[ \t]*[—–][ \t]*(\d)/g, "$1-$2")
      // Everything else is punctuation. Only spaces and tabs are eaten, so a
      // dash at the end of a line cannot swallow the newline after it.
      .replace(/[ \t]*[—–][ \t]*/g, ", ")
      // The replacement can land next to punctuation that was already there.
      .replace(/,[ \t]*,+/g, ",")
      .replace(/([,;:.!?])[ \t]*,/g, "$1")
      .replace(/,([ \t]*[.!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+$/gm, "")
      .trim()
  );
}

/**
 * The imperfections a real person leaves behind: a dropped apostrophe, mostly.
 *
 * Deliberately the mildest kind. A dropped apostrophe reads as someone typing
 * fast on a phone; a mangled word reads as broken, and a misspelled product or
 * platform name reads as careless about the thing being sold. So the list below
 * touches only common contractions, never a noun, and never a brand.
 */
const CONTRACTIONS = [
  "don't",
  "doesn't",
  "didn't",
  "isn't",
  "wasn't",
  "can't",
  "won't",
  "that's",
  "you're",
  "they're",
  "there's",
  "what's",
  "it's"
];

/**
 * Matches a contraction wherever it sits in a sentence.
 *
 * Case-insensitive, because a post is as likely to open with "That's" as to
 * carry "that's" mid-line; and either apostrophe, because model output uses the
 * curly one while hand-typed copy uses the straight one. Getting this wrong
 * fails silently - the pass simply never fires and every post stays immaculate,
 * which is the thing it exists to prevent.
 */
function contractionPattern(word: string): RegExp {
  return new RegExp(`\\b${word.replace("'", "['\u2019]")}\\b`, "i");
}

/** Segments that must never be altered: links, handles, hashtags. */
const PROTECTED = /(https?:\/\/\S+|@[\w.]+|#\w+)/g;

/**
 * Applies at most ONE small slip, to `rate` of posts, chosen deterministically
 * from the seed so a post does not change every time it is re-read.
 *
 * Returns the text untouched when the roll fails or nothing safe matches —
 * which is the common case, and meant to be.
 */
export function sprinkleTypo(text: string, seed: string, rate: number): string {
  if (rate <= 0) return text;
  const roll = hash32(`typo:${seed}`) % 1000;
  if (roll >= Math.round(rate * 1000)) return text;

  // Split protected runs out so a handle or link can never be edited, then put
  // them back exactly as they were.
  const parts = text.split(PROTECTED);
  const editable = parts.map((part, index) => (index % 2 === 0 ? part : null));

  const candidates: Array<{ part: number; pattern: RegExp }> = [];
  editable.forEach((part, index) => {
    if (part === null) return;
    for (const word of CONTRACTIONS) {
      const pattern = contractionPattern(word);
      if (pattern.test(part)) candidates.push({ part: index, pattern });
    }
  });
  if (candidates.length === 0) return text;

  // Dropping the apostrophe off the match keeps whatever capitalisation it had.
  const pick = candidates[hash32(`pick:${seed}`) % candidates.length];
  parts[pick.part] = parts[pick.part].replace(pick.pattern, (match) => match.replace(/['\u2019]/g, ""));
  return parts.join("");
}

export type HumanizeOptions = {
  /** Share of posts that get one small slip. 0 disables it entirely. */
  typoRate?: number;
};

/** How often a post picks up a slip when nothing is configured. */
export const DEFAULT_TYPO_RATE = 0.08;

/** The share of posts that get a slip, from THREADS_TYPO_RATE. */
export function typoRate(): number {
  const raw = Number(process.env.THREADS_TYPO_RATE);
  if (!Number.isFinite(raw)) return DEFAULT_TYPO_RATE;
  return Math.min(1, Math.max(0, raw));
}

/** The full pass: always de-dashed, occasionally imperfect. */
export function humanize(text: string, seed: string, options: HumanizeOptions = {}): string {
  return sprinkleTypo(stripDashes(text), seed, options.typoRate ?? typoRate());
}
