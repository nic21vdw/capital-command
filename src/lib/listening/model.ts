import { z } from "zod";

/**
 * Listening — find the public threads where someone is describing the exact
 * problem CoLateral solves (too many terminals, juggling Claude Code and Codex,
 * hunting for a Cursor alternative), so Nic can answer the ones he genuinely
 * can help with.
 *
 * Pure: schemas, defaults, the two response parsers, term matching and the
 * dedupe merge. Network lives in scan.ts and disk in store.ts, so everything
 * here is tested against fixture JSON with no network at all.
 */

export const LISTENING_INTENTS = ["pain", "comparison", "pricing"] as const;
export type ListeningIntent = (typeof LISTENING_INTENTS)[number];

export const LISTENING_SOURCES = ["hn", "reddit"] as const;
export type ListeningSource = (typeof LISTENING_SOURCES)[number];

export const RESULT_STATUSES = ["new", "replied", "ignored"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const SOURCE_LABELS: Record<ListeningSource, string> = { hn: "Hacker News", reddit: "Reddit" };

export const keywordGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  terms: z.array(z.string().trim().min(1)).default([]),
  intent: z.enum(LISTENING_INTENTS)
});
export type KeywordGroup = z.infer<typeof keywordGroupSchema>;

export const listeningResultSchema = z.object({
  id: z.string().min(1),
  source: z.enum(LISTENING_SOURCES),
  title: z.string(),
  url: z.string().min(1),
  author: z.string().default(""),
  /** When the post or comment was written (ISO). */
  createdAt: z.string(),
  /** A short plain-text excerpt, so the list can be triaged without opening every link. */
  excerpt: z.string().default(""),
  matchedTerms: z.array(z.string()).default([]),
  status: z.enum(RESULT_STATUSES).default("new"),
  note: z.string().default(""),
  /** When a scan first found it (ISO). */
  foundAt: z.string()
});
export type ListeningResult = z.infer<typeof listeningResultSchema>;

export const sourceReportSchema = z.object({
  source: z.enum(LISTENING_SOURCES),
  ok: z.boolean(),
  /** Queries actually sent. */
  queries: z.number().int().min(0),
  /** Hits the source returned that matched a term. */
  matched: z.number().int().min(0),
  /** Of those, how many were not already on the list. */
  added: z.number().int().min(0),
  httpStatus: z.number().int().optional(),
  error: z.string().optional()
});
export type SourceReport = z.infer<typeof sourceReportSchema>;

export const scanReportSchema = z.object({
  at: z.string(),
  sources: z.array(sourceReportSchema)
});
export type ScanReport = z.infer<typeof scanReportSchema>;

export const DEFAULT_KEYWORD_GROUPS: KeywordGroup[] = [
  {
    id: "pain",
    name: "Juggling agents",
    intent: "pain",
    terms: [
      "multiple claude code",
      "claude code worktrees",
      "run codex and claude",
      "too many terminals ai agents",
      "parallel ai coding agents"
    ]
  },
  {
    id: "comparison",
    name: "Looking for an alternative",
    intent: "comparison",
    terms: ["cursor alternative", "conductor app claude", "warp alternative", "claude code gui"]
  },
  {
    id: "pricing",
    name: "Subscription fatigue",
    intent: "pricing",
    terms: ["ai tool subscription fatigue", "one-time license ai"]
  }
];

export const listeningStoreSchema = z.object({
  groups: z.array(keywordGroupSchema).default(DEFAULT_KEYWORD_GROUPS),
  sources: z.object({ hn: z.boolean().default(true), reddit: z.boolean().default(true) }).default({ hn: true, reddit: true }),
  results: z.array(listeningResultSchema).default([]),
  lastScan: scanReportSchema.optional()
});
export type ListeningStore = z.infer<typeof listeningStoreSchema>;

export const defaultListeningStore: ListeningStore = {
  groups: DEFAULT_KEYWORD_GROUPS,
  sources: { hn: true, reddit: true },
  results: []
};

/** The most results kept. Older ones fall off first, but a result you marked keeps its place over a new one. */
export const MAX_RESULTS = 1000;

/** Shown on the page before anyone replies to anything. */
export const REPLY_CHECKLIST = [
  "Say plainly that you built CoLateral before you mention it.",
  "Only reply when it genuinely answers the question being asked - otherwise leave it.",
  "Write each reply for that thread. No copy-paste replies, no templates."
] as const;

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&#x2F;": "/" };

/** HN comment text is HTML; Reddit's selftext is markdown. Both read as plain text here. */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|#x2F);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Does this text talk about this term? The exact phrase counts, and so does
 * every word of it appearing somewhere in the text ("worktrees with Claude
 * Code" is about "claude code worktrees"). Search engines match loosely, so a
 * hit the term does not survive this is noise and is dropped.
 */
export function termMatches(text: string, term: string): boolean {
  const haystack = text.toLowerCase();
  if (haystack.includes(term.toLowerCase().trim())) return true;
  const present = new Set(words(text));
  const needed = words(term);
  return needed.length > 0 && needed.every((word) => present.has(word) || (word.length > 3 && present.has(`${word}s`)));
}

export function matchingTerms(text: string, terms: string[]): string[] {
  return [...new Set(terms.filter((term) => termMatches(text, term)))];
}

export function allTerms(groups: KeywordGroup[]): string[] {
  return [...new Set(groups.flatMap((group) => group.terms.map((term) => term.trim()).filter(Boolean)))];
}

// ---------------------------------------------------------------------------
// Parsing — one function per source, each taking the raw JSON it returned
// ---------------------------------------------------------------------------

/** A hit before it has a status, a note or an id. */
export interface ListeningHit {
  source: ListeningSource;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  excerpt: string;
  matchedTerms: string[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function excerptOf(text: string): string {
  const plain = plainText(text);
  return plain.length > 280 ? `${plain.slice(0, 277)}...` : plain;
}

/**
 * Parse an Algolia HN search response. The url is always the HN item page,
 * because that is where a reply goes — a story's own link is somebody's
 * product page. A comment's title is its story's.
 */
export function parseHnResponse(json: unknown, terms: string[]): ListeningHit[] {
  const hits = (json as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits)) throw new Error("Hacker News answered without a hits list.");
  const out: ListeningHit[] = [];
  for (const raw of hits) {
    if (!raw || typeof raw !== "object") continue;
    const hit = raw as Record<string, unknown>;
    const id = str(hit.objectID);
    if (!id) continue;
    const isComment = Array.isArray(hit._tags) && hit._tags.includes("comment");
    const title = plainText(str(hit.title) || str(hit.story_title)) || "(untitled)";
    const body = str(hit.comment_text) || str(hit.story_text);
    const matched = matchingTerms(`${title} ${plainText(body)}`, terms);
    if (matched.length === 0) continue;
    out.push({
      source: "hn",
      title: isComment ? `Comment on: ${title}` : title,
      url: `https://news.ycombinator.com/item?id=${id}`,
      author: str(hit.author),
      createdAt: str(hit.created_at) || new Date(Number(hit.created_at_i ?? 0) * 1000).toISOString(),
      excerpt: excerptOf(body),
      matchedTerms: matched
    });
  }
  return out;
}

/** Parse a reddit.com/search.json listing. The url is the thread's permalink. */
export function parseRedditResponse(json: unknown, terms: string[]): ListeningHit[] {
  const children = (json as { data?: { children?: unknown } } | null)?.data?.children;
  if (!Array.isArray(children)) throw new Error("Reddit answered without a listing.");
  const out: ListeningHit[] = [];
  for (const child of children) {
    const data = (child as { data?: Record<string, unknown> } | null)?.data;
    if (!data) continue;
    const permalink = str(data.permalink);
    if (!permalink) continue;
    const title = plainText(str(data.title)) || "(untitled)";
    const body = str(data.selftext);
    const matched = matchingTerms(`${title} ${body}`, terms);
    if (matched.length === 0) continue;
    const subreddit = str(data.subreddit);
    const created = Number(data.created_utc);
    out.push({
      source: "reddit",
      title: subreddit ? `r/${subreddit}: ${title}` : title,
      url: `https://www.reddit.com${permalink.startsWith("/") ? permalink : `/${permalink}`}`,
      author: str(data.author),
      createdAt: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : new Date(0).toISOString(),
      excerpt: excerptOf(body),
      matchedTerms: matched
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

/** The dedupe key: no protocol, no www, no trailing slash, no fragment, case-folded. */
export function normalizeResultUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(?:www\.|old\.)/, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

function resultId(hit: ListeningHit): string {
  let hash = 0x811c9dc5;
  const key = normalizeResultUrl(hit.url);
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${hit.source}-${(hash >>> 0).toString(36)}`;
}

/**
 * Fold a scan's hits into the stored results, one entry per url. A url already
 * on the list keeps its status and note — a scan never resurrects something
 * marked ignored — and only gains any newly matched terms. Returns how many
 * were genuinely new.
 */
export function mergeResults(
  existing: ListeningResult[],
  hits: ListeningHit[],
  foundAt = new Date().toISOString()
): { results: ListeningResult[]; added: number } {
  const byUrl = new Map<string, ListeningResult>();
  for (const result of existing) byUrl.set(normalizeResultUrl(result.url), result);
  let added = 0;
  for (const hit of hits) {
    const key = normalizeResultUrl(hit.url);
    const known = byUrl.get(key);
    if (known) {
      const terms = [...new Set([...known.matchedTerms, ...hit.matchedTerms])];
      if (terms.length !== known.matchedTerms.length) byUrl.set(key, { ...known, matchedTerms: terms });
      continue;
    }
    byUrl.set(key, { ...hit, id: resultId(hit), status: "new", note: "", foundAt });
    added += 1;
  }
  const results = [...byUrl.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { results: capResults(results), added };
}

function capResults(results: ListeningResult[]): ListeningResult[] {
  if (results.length <= MAX_RESULTS) return results;
  // Results arrive newest first. Drop untouched "new" ones from the old end
  // before anything Nic marked, then plain age if that is still not enough.
  const overflow = results.length - MAX_RESULTS;
  const dropIds = new Set(
    [...results]
      .reverse()
      .filter((result) => result.status === "new" && !result.note)
      .slice(0, overflow)
      .map((result) => result.id)
  );
  const kept = results.filter((result) => !dropIds.has(result.id));
  return kept.slice(0, MAX_RESULTS);
}

export function intentOfTerms(groups: KeywordGroup[], terms: string[]): ListeningIntent[] {
  const wanted = new Set(terms.map((term) => term.toLowerCase()));
  return [...new Set(groups.filter((group) => group.terms.some((term) => wanted.has(term.toLowerCase()))).map((group) => group.intent))];
}
