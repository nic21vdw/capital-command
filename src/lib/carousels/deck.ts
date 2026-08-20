/**
 * How big a carousel deck is, and how many decks one source produces.
 *
 * Kept free of every other import so the page picking the numbers and the
 * server writing the slides agree on the same rules — the picker can show
 * "12 photos → 12 slides" because it applies the exact function the generator
 * will.
 */

export const DEFAULT_SLIDE_COUNT = 8;
export const MIN_SLIDES = 4;
/** Instagram's per-post ceiling — the most slides one carousel can hold. */
export const MAX_SLIDES = 20;

export const DEFAULT_BATCH_COUNT = 1;
export const MAX_BATCH_COUNT = 5;

/**
 * The angle each batch is given. Asking one model for the same carousel five
 * times returns five rewrites of the same post; handing each batch its own
 * brief is what makes "3 batches of 8 slides" three posts worth publishing on
 * three different days. They cycle, so a sixth batch would reuse the first's.
 */
export const CAROUSEL_ANGLES = [
  {
    label: "The story",
    instruction:
      "Tell what actually happened, in order — the moment-by-moment story of this stream, with the turn or the surprise in the middle."
  },
  {
    label: "The lessons",
    instruction:
      "Pull the lessons out: what this proves, what it changed, what would be done differently next time. One lesson per slide."
  },
  {
    label: "The how-to",
    instruction:
      "Make it practical — the steps someone could copy tomorrow, in the order they would do them. Only steps that are actually in the source."
  },
  {
    label: "The mistakes",
    instruction:
      "Lead with the mistakes, myths and traps: what not to do and what to do instead. Blunt, never smug."
  },
  {
    label: "The receipts",
    instruction:
      "Lead with the specifics that were actually said — the numbers, tools, names and results. Never invent one to fill a slide."
  }
] as const;

export function carouselAngle(index: number): (typeof CAROUSEL_ANGLES)[number] {
  const length = CAROUSEL_ANGLES.length;
  return CAROUSEL_ANGLES[((index % length) + length) % length];
}

/**
 * How many slides a deck actually gets. Every uploaded photo earns its own
 * slide: quietly dropping four of twelve photos because the picker still said
 * "8 slides" would throw away material the user chose by hand.
 */
export function resolveSlideCount(input: { slideCount?: number; imageCount?: number }): number {
  const asked =
    Number.isFinite(input.slideCount) && (input.slideCount ?? 0) > 0 ? Math.round(input.slideCount!) : DEFAULT_SLIDE_COUNT;
  const wanted = Math.max(asked, input.imageCount ?? 0);
  return Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, wanted));
}

export function clampBatchCount(count?: number): number {
  if (!Number.isFinite(count) || !count || count < 1) return DEFAULT_BATCH_COUNT;
  return Math.min(MAX_BATCH_COUNT, Math.round(count));
}

/**
 * Openers that are not hooks. A greeting, a mic check, a bare day counter or a
 * house catchphrase is what the model reaches for when it takes the first thing
 * said in the recording instead of the best thing in it — every one of these was
 * pulled from a deck that actually went out.
 */
const WEAK_HOOK_PATTERNS: RegExp[] = [
  /^(hey|hi|hello|yo|what'?s up|how are we|how'?s everyone|good (morning|evening))\b/i,
  /\bwho wants it\b/i,
  /^(let'?s go|we'?re (live|back)|welcome back|come on,? \w+)\b/i,
  /\b(mic|audio|sound) (check|test)\b/i,
  /\btesting the (mic|audio)\b/i,
  /\bbuilding in public\b/i,
  /\bone vibe(?: coding session)? at a time\b/i,
  /\bbig things (are )?coming\b/i,
  /\b(this is )?(only |just )?(the beginning|getting started|the start)\b/i,
  /\bfollow the journey\b/i
];

/** A day counter with nothing else in it — "Day 37 of vibe coding". */
const BARE_DAY_COUNTER = /^day\s*\d+\s*(of\s+(vibe\s+coding|building|streaming))?[\s\p{P}\p{S}]*$/iu;

/**
 * Why this hook is not good enough, or null when it is.
 *
 * Checked in code rather than only asked for in the prompt: a hook is the one
 * slide the whole deck depends on, and "please write a good one" is advice the
 * model takes on most runs and not on the run nobody is watching. A weak hook
 * costs a retry, which is cheap; a weak hook that ships costs the post.
 */
export function hookProblem(hook: { heading?: string; body?: string } | undefined): string | null {
  const heading = (hook?.heading ?? "").trim();
  if (!heading) return "the hook slide has no heading";
  const bare = heading.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}️]/gu, "").trim();
  if (!bare) return "the hook slide is nothing but emoji";
  if (BARE_DAY_COUNTER.test(bare)) return `the hook is a bare day counter ("${heading}")`;
  for (const pattern of WEAK_HOOK_PATTERNS) {
    if (pattern.test(bare)) return `the hook is a greeting or a stock phrase rather than a claim ("${heading}")`;
  }
  return null;
}

/**
 * Words a title leaves lowercase unless they open or close it. The usual
 * headline set — articles, coordinating conjunctions and the short
 * prepositions.
 */
const TITLE_MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
  "of", "off", "on", "onto", "or", "over", "per", "so", "the", "to", "up", "via",
  "vs", "with", "yet"
]);

/**
 * A heading set the way a headline is set: the first letter of every word that
 * carries meaning.
 *
 * A word that already has a capital inside it is left exactly as written —
 * that is what keeps CoLateral, OBS, AI and PE from being flattened into
 * Colateral, Obs, Ai and Pe. Hyphenated and slashed compounds are capitalised
 * on both sides, and the first and last words always are, whatever they are.
 */
export function titleCaseHeading(heading: string): string {
  const words = heading.split(/(\s+)/);
  const indexes = words.map((word, index) => (word.trim() ? index : -1)).filter((index) => index >= 0);
  const first = indexes[0];
  const last = indexes[indexes.length - 1];

  return words
    .map((word, index) => {
      if (!word.trim()) return word;
      return word
        .split(/([-/])/)
        .map((part, partIndex) => {
          if (!/[a-z]/i.test(part)) return part;
          // Anything with its own capitals is a name the writer set on purpose.
          if (/[A-Z]/.test(part.slice(1))) return part;
          const bare = part.replace(/[^a-z']/gi, "").toLowerCase();
          const minor = TITLE_MINOR_WORDS.has(bare) && index !== first && index !== last && partIndex === 0;
          if (minor) return part.toLowerCase();
          // Only a letter the word actually STARTS with. Reaching further in
          // capitalises the letters that follow a number — "11pm" became
          // "11Pm" and "1st" became "1St".
          return part.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_all, lead, letter) => lead + letter.toUpperCase());
        })
        .join("");
    })
    .join("");
}
