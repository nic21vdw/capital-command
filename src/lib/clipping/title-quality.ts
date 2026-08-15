import { CHANNEL_ENTITIES } from "@/lib/clipping/keywords";

/**
 * The gate every clip title passes before it can reach the publish queue.
 *
 * Auto-titling used to hand raw speech-to-text straight to YouTube — "Thank,
 * Max and Tool", "Have We've Started on This Grind", "What Is Up My Man" all
 * shipped as Shorts. The generators (the Claude titler in titles.ts and the
 * heuristic titler in editor.ts) could each tell a *long* fragment from a short
 * one, but neither could tell a sentence from a title. This module is that
 * judgement, in one place, so both paths reject the same things.
 *
 * Two levels, deliberately:
 *
 * - **Rejections** are structural — a title that trips one is not a title at
 *   all, and is never publishable. Each carries a code and a human reason so
 *   the pipeline can say in a job notice *why* a clip needs a hand-written one.
 * - **Warnings** are the channel-audit preferences (name a tool early, make one
 *   claim, don't say "we"). They only lower the score, because not every clip
 *   can name a tool and a warned title still beats no title.
 *
 * Dependency-free on purpose: the client-side Clip Generator and Uploading
 * Center import it to gate the headline they show, same as the server does.
 */

/** Longest a clip title may be. Shared with the AI titler's cleanup step. */
export const MAX_TITLE_CHARS = 75;

/** Shortest a title may be. Below this it is a caption, not a headline. */
export const MIN_TITLE_WORDS = 4;

/** How far into a title a named tool still counts as "leading with it". */
const ENTITY_LEAD_WORDS = 4;

export type TitleRejectionCode =
  | "empty"
  | "too-short"
  | "too-long"
  | "leading-comma"
  | "dangling-edge"
  | "auxiliary-opening"
  | "doubled-auxiliary"
  | "self-talk"
  | "repeated-phrase"
  | "stray-numeral"
  | "todo-voice"
  | "no-topic";

export type TitleWarningCode = "no-named-subject" | "we-voice" | "multi-claim";

export type TitleJudgement = {
  /** Whether this title may be published as-is. */
  publishable: boolean;
  /** Set when `publishable` is false — the rule that rejected it. */
  code?: TitleRejectionCode;
  /** Set when `publishable` is false — a sentence fit to show in a job notice. */
  reason?: string;
  /** Channel-audit misses. Never block publishing; they cost score. */
  warnings: TitleWarningCode[];
  /** 0-100. Ranks passing candidates against each other; 0 when rejected. */
  score: number;
};

// Auxiliaries and modals. A title that OPENS on one is a sentence that lost
// its subject ("Have 16 Members", "Have We've Started on This Grind").
const AUXILIARIES = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "have", "has", "had",
  "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may",
  "might", "must"
]);

// Pronoun contractions. An auxiliary followed by one of these is the classic
// transcript stutter: "Have We've", "Did I'm".
const PRONOUN_CONTRACTIONS = new Set([
  "i'm", "i've", "i'll", "i'd", "we've", "we're", "we'll", "we'd", "you've",
  "you're", "you'll", "you'd", "they've", "they're", "they'll", "he's", "she's",
  "it's", "that's", "there's", "here's"
]);

// Words that leave a title dangling when it ENDS on them — the thought is
// still owed a noun. "Claude Writes the Code I Used To" trails off here.
const TRAILING_DANGLERS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "of", "to", "in",
  "on", "at", "by", "with", "for", "from", "as", "than", "then", "into", "onto",
  "upon", "over", "under", "about", "inside", "outside", "within", "without",
  "because", "since", "while", "though", "although", "if", "unless", "until",
  "my", "your", "our", "their", "these", "those", "some", "any", "very",
  "just", "really", "also", "too"
]);

// The narrower set that also ruins a title when it OPENS on one: a preposition
// or conjunction with nothing in front of it ("Inside Your Local"). Determiners
// and possessives are deliberately absent — "My AI App Beta Is Finally Done"
// and "The Best Way to Organize AI Agents" are titles the channel wants.
const LEADING_DANGLERS = new Set([
  "and", "or", "but", "nor", "so", "yet", "of", "to", "in", "on", "at", "by",
  "with", "for", "from", "as", "than", "into", "onto", "upon", "over", "under",
  "inside", "outside", "within", "without", "because", "since", "although",
  "unless", "until"
]);

// Auxiliary pairs that are ordinary English rather than a transcript stutter:
// "should be", "has been", "is being". Anything else — "Has Is", "Have We've" —
// is two starts of the same sentence stitched together.
const LEGITIMATE_AUXILIARY_PAIRS = new Set([
  "can be", "could be", "will be", "would be", "shall be", "should be", "may be",
  "might be", "must be", "can have", "could have", "will have", "would have",
  "should have", "may have", "might have", "must have", "could been",
  "would been", "should been", "can do", "could do", "will do", "would do",
  "should do", "did do", "does have", "do have", "did have", "has been",
  "have been", "had been", "is being", "are being", "was being", "were being"
]);

// Openings that are the creator talking to the room rather than a title:
// greetings, stream chatter, and thinking-out-loud. Matched as a phrase on the
// start of the title, so "Why I'm Shipping This With Bugs" is untouched.
const SELF_TALK_OPENERS = [
  "what is up", "what's up", "how's it going", "how is it going", "hey guys",
  "hey everyone", "hi guys", "welcome back", "thank you", "thanks for",
  "let's get", "let's go", "let's do", "let's talk", "let me", "i'm curious",
  "i am curious", "i think", "i guess", "i mean", "i don't know", "i dunno",
  "you know", "you guys", "i was gonna", "i was going"
];

// Imperatives aimed at the creator, not the viewer — a content idea written as
// a to-do ("Show Beginners How to Vibe Code With ChatGPT") rather than a
// promise to the person scrolling. Viewer-facing imperatives ("Replace AutoCAD
// With One AI Workspace", "Stop Doing Work") are not in here and must not be.
const CREATOR_IMPERATIVES = new Set([
  "show", "teach", "explain", "demonstrate", "demo", "cover", "discuss",
  "describe", "mention", "remind", "highlight", "showcase", "walkthrough",
  "record", "film",
  // Gratitude aimed at the room, not the scroller: "Thank, Max and Tool" was a
  // shout-out to chat that shipped as a Short. "Thanking My First 50
  // Subscribers Live" is a different word and stays allowed.
  "thank", "thanks"
]);

// Verbs a bare numeral must never run into. "Brag of It 80 Get the Best 80"
// reads as a number that lost its noun; "FABLE 5 IS GONE" does not, which is
// why copulas are excluded from this set.
const ACTION_VERBS_AFTER_NUMERAL = new Set([
  "get", "go", "make", "do", "take", "say", "know", "think", "want", "need",
  "start", "stop", "come", "look", "give", "put", "keep", "let", "tell", "try",
  "brag", "talk", "run"
]);

// Time periods that make an empty subject. "July's Been a Great Month" is a
// diary entry: the thing it is about is a calendar square.
const TIME_SUBJECTS = new Set([
  "today", "tonight", "yesterday", "tomorrow", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "january", "february", "march",
  "april", "may", "june", "july", "august", "september", "october", "november",
  "december", "week", "month", "year", "morning", "afternoon", "evening",
  "night", "weekend", "it", "this", "that", "everything", "things", "stuff"
]);

const WE_WORDS = new Set(["we", "we're", "we've", "we'll", "we'd", "our", "ours", "us"]);

// Words that legitimately take a bare number after them, so the number is an
// object rather than a fragment: "Day 8", "Crash at 900", "by 2028".
const NUMERAL_LABELS = new Set([
  "day", "days", "part", "ep", "episode", "week", "month", "year", "no", "number",
  "chapter", "round", "level", "at", "to", "from", "by", "of", "in", "on", "over",
  "under", "hits", "hit", "past", "under", "for"
]);

/** Strips emoji, hashtags and wrapping quotes so the rules see words only. */
function normalize(raw: string): string {
  return raw
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/#[\w-]+/g, " ")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The bare word inside a token: no surrounding punctuation, lowercased. */
function word(token: string): string {
  return token.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "").toLowerCase();
}

function isBareNumeral(value: string): boolean {
  return /^\d+$/.test(value);
}

function reject(code: TitleRejectionCode, reason: string): TitleJudgement {
  return { publishable: false, code, reason, warnings: [], score: 0 };
}

/**
 * Judges a candidate title. Structural failures come back with a code and a
 * reason worth showing a human; passing titles carry any channel-audit
 * warnings and a score for ranking them against each other.
 */
export function judgeTitle(raw: string): TitleJudgement {
  const title = normalize(raw ?? "");
  if (!title) return reject("empty", "The title is empty.");

  const tokens = title.split(" ").filter(Boolean);
  const words = tokens.map(word).filter(Boolean);
  if (words.length < MIN_TITLE_WORDS) {
    return reject(
      "too-short",
      `Only ${words.length} word${words.length === 1 ? "" : "s"} — too thin to read as a headline.`
    );
  }
  if (title.length > MAX_TITLE_CHARS) {
    return reject("too-long", `${title.length} characters — longer than the ${MAX_TITLE_CHARS} a Short can show.`);
  }

  // A comma this early means the transcript was cut mid-address, not that the
  // title has a clause: "Thank, Max and Tool". Thousands separators don't count.
  if (tokens.slice(0, 2).some((token) => /(?<!\d),|,(?!\d)/.test(token))) {
    return reject("leading-comma", "Opens on a comma-spliced fragment rather than a phrase.");
  }

  const first = words[0];
  const last = words[words.length - 1];
  if (LEADING_DANGLERS.has(first)) {
    return reject("dangling-edge", `Starts on "${tokens[0]}", so the phrase has no subject.`);
  }
  if (TRAILING_DANGLERS.has(last)) {
    return reject("dangling-edge", `Ends on a dangling "${tokens[tokens.length - 1]}".`);
  }

  if (AUXILIARIES.has(first)) {
    return reject("auxiliary-opening", `Opens on the auxiliary "${tokens[0]}" — a sentence missing its subject.`);
  }

  for (let i = 0; i < words.length - 1; i += 1) {
    const next = words[i + 1];
    if (!AUXILIARIES.has(words[i])) continue;
    const stutter = PRONOUN_CONTRACTIONS.has(next)
      || (AUXILIARIES.has(next) && !LEGITIMATE_AUXILIARY_PAIRS.has(`${words[i]} ${next}`));
    if (stutter) {
      return reject("doubled-auxiliary", `"${tokens[i]} ${tokens[i + 1]}" is a stutter, not grammar.`);
    }
  }

  const lower = words.join(" ");
  const opener = SELF_TALK_OPENERS.find((phrase) => lower.startsWith(phrase));
  if (opener) {
    return reject("self-talk", `Opens on stream chatter ("${opener}") instead of naming the topic.`);
  }

  if (CREATOR_IMPERATIVES.has(first)) {
    return reject("todo-voice", `Reads as a to-do for the creator ("${tokens[0]} …"), not a promise to the viewer.`);
  }

  for (let i = 0; i < words.length - 2; i += 1) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    for (let j = i + 1; j < words.length - 1; j += 1) {
      if (bigram === `${words[j]} ${words[j + 1]}`) {
        return reject("repeated-phrase", `Repeats "${bigram}" — the transcript looped.`);
      }
    }
  }

  // A number at the end is fine when something introduced it — "Day 8",
  // "by 2028", "Crash at 900". "…Get the Best 80" introduced nothing.
  const beforeLast = words[words.length - 2];
  const labelled = NUMERAL_LABELS.has(beforeLast) || /^(19|20)\d{2}$/.test(last);
  if (isBareNumeral(last) && !labelled) {
    return reject("stray-numeral", `Ends on the bare number "${last}", which reads as a transcript artefact.`);
  }
  for (let i = 0; i < words.length - 1; i += 1) {
    if (isBareNumeral(words[i]) && ACTION_VERBS_AFTER_NUMERAL.has(words[i + 1])) {
      return reject("stray-numeral", `"${words[i]} ${words[i + 1]}" uses a number as a word.`);
    }
  }

  const named = namedSubjects(words);
  // "July's Been a Great Month": a calendar square or a bare "this/it" as the
  // subject, a copula, and nothing concrete anywhere — an entry in a diary.
  const firstBase = first.replace(/'s$/, "");
  if (TIME_SUBJECTS.has(firstBase) && AUXILIARIES.has(words[1]) && named.length === 0) {
    return reject("no-topic", `"${tokens[0]} ${tokens[1]} …" makes no claim about anything the viewer can see.`);
  }

  const warnings: TitleWarningCode[] = [];
  const leads = namedSubjects(words.slice(0, ENTITY_LEAD_WORDS)).length > 0;
  if (named.length === 0) warnings.push("no-named-subject");
  if (words.some((value) => WE_WORDS.has(value))) warnings.push("we-voice");
  if (title.split(/[.;]|\s—\s/).filter((part) => part.trim()).length > 1) warnings.push("multi-claim");

  let score = 60;
  if (named.length > 0) score += 15;
  if (leads) score += 15;
  if (words.length >= 5 && words.length <= 10) score += 10;
  for (const warning of warnings) score -= warning === "no-named-subject" ? 15 : 10;

  return { publishable: true, warnings, score: Math.max(0, Math.min(100, score)) };
}

/** Which channel entities (Claude, Opus, CoLateral, Revit …) a title names. */
function namedSubjects(words: string[]): string[] {
  const text = ` ${words.join(" ")} `;
  return CHANNEL_ENTITIES.filter((entity) => text.includes(` ${entity.toLowerCase()} `));
}

/** Whether a title names one of the channel's tools, models or products. */
export function titleNamesChannelEntity(title: string): boolean {
  return namedSubjects(normalize(title).split(" ").map(word).filter(Boolean)).length > 0;
}

/** Convenience predicate for callers that only need yes/no. */
export function titleIsPublishable(title: string): boolean {
  return judgeTitle(title).publishable;
}

/**
 * The first candidate that clears the gate, or null when none do. Callers use
 * the null to fall back to an obvious placeholder ("Clip 3") rather than
 * dressing a transcript fragment up as a finished title.
 */
export function firstPublishableTitle(candidates: Array<string | undefined | null>): string | null {
  for (const candidate of candidates) {
    if (candidate && titleIsPublishable(candidate)) return candidate;
  }
  return null;
}

/** The channel-audit rules, spelled out for the AI titler's system prompt. */
export const TITLE_QUALITY_RULES = [
  "Name something concrete in the first four words — a tool, product or model (e.g. Claude, Opus 5, Cursor, CoLateral, AutoCAD, Revit, ChatGPT) whenever the clip genuinely involves one.",
  "Make exactly one present-tense claim. No second sentence, no semicolons, no em-dash asides.",
  "Write to the viewer, never to yourself: never a to-do like \"Show beginners how to …\".",
  "Prefer \"I\" or the tool itself as the subject over \"we\".",
  `At least ${MIN_TITLE_WORDS} words and at most ${MAX_TITLE_CHARS} characters.`,
  "Never open on an auxiliary (Have/Is/Did), a bare article or preposition, a comma, or stream chatter (\"What is up\", \"Let's get started\", \"Thank you\").",
  "Never end on a preposition, conjunction, article or a bare number.",
  "Never repeat a phrase, and never use a number as if it were a word."
];
