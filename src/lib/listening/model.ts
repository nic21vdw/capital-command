import { z } from "zod";
import { DEFAULT_KEYWORD_GROUPS } from "@/lib/listening/defaults";

export { DEFAULT_KEYWORD_GROUPS };

/**
 * Listening — find the public threads where someone is describing the exact
 * problem CoLateral solves (too many terminals, juggling Claude Code and Codex,
 * hunting for a Cursor alternative), so Nic can answer the ones he genuinely
 * can help with.
 *
 * Pure: schemas, defaults, term matching and the dedupe merge. The response
 * parsers are here (Hacker News, Reddit) and in parsers.ts (YouTube, Bluesky).
 * Network lives in scan.ts and disk in config.ts and store.ts, so everything
 * here is tested against fixture JSON with no network at all.
 */

export const LISTENING_INTENTS = ["pain", "comparison", "pricing", "brand", "competitor"] as const;
export type ListeningIntent = (typeof LISTENING_INTENTS)[number];

export const LISTENING_SOURCES = ["hn", "reddit", "youtube", "bluesky", "x"] as const;
export type ListeningSource = (typeof LISTENING_SOURCES)[number];

export const RESULT_STATUSES = ["new", "seen", "sent-to-outreach", "dismissed"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const HIT_CATEGORIES = ["lead", "mention", "competitor", "noise"] as const;
export type HitCategory = (typeof HIT_CATEGORIES)[number];

export const SOURCE_LABELS: Record<ListeningSource, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  youtube: "YouTube",
  bluesky: "Bluesky",
  x: "X"
};

export const SOURCE_NOTES: Partial<Record<ListeningSource, string>> = { x: "Needs X API access" };

export const MAX_TERMS_PER_GROUP = 12;

export const keywordGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  terms: z.array(z.string().trim().min(1)).max(MAX_TERMS_PER_GROUP).default([]),
  intent: z.enum(LISTENING_INTENTS),
  canLead: z.boolean().default(true)
});
export type KeywordGroup = z.infer<typeof keywordGroupSchema>;

function legacyStatus(value: unknown): unknown {
  if (value === "replied") return "seen";
  if (value === "ignored") return "dismissed";
  return value;
}

export const sourceReference = z.object({ source: z.enum(LISTENING_SOURCES), url: z.string().min(1) });

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
  status: z.preprocess(legacyStatus, z.enum(RESULT_STATUSES).default("new")),
  note: z.string().default(""),
  /** When a scan first found it (ISO). */
  foundAt: z.string(),
  category: z.enum(HIT_CATEGORIES).default("mention"),
  sentiment: z.number().min(-1).max(1).default(0),
  score: z.number().min(0).max(100).default(0),
  reason: z.string().default(""),
  classifiedBy: z.enum(["ai", "heuristic"]).default("heuristic"),
  alsoOn: z.array(sourceReference).default([]),
  outreachContactId: z.string().optional()
});
export type ListeningResult = z.infer<typeof listeningResultSchema>;

export const sourceReportSchema = z.object({
  source: z.enum(LISTENING_SOURCES),
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  /** Queries actually sent. */
  queries: z.number().int().min(0),
  /** Hits the source returned that matched a term. */
  matched: z.number().int().min(0),
  /** Of those, how many were not already on the list. */
  added: z.number().int().min(0),
  httpStatus: z.number().int().optional(),
  error: z.string().optional(),
  note: z.string().optional()
});
export type SourceReport = z.infer<typeof sourceReportSchema>;

export const scanReportSchema = z.object({
  at: z.string(),
  sources: z.array(sourceReportSchema),
  classified: z.object({ ai: z.number().int().min(0), heuristic: z.number().int().min(0) }).optional(),
  error: z.string().optional()
});
export type ScanReport = z.infer<typeof scanReportSchema>;

const sourceSwitchesSchema = z.object({
  hn: z.boolean().default(true),
  reddit: z.boolean().default(true),
  youtube: z.boolean().default(false),
  bluesky: z.boolean().default(true),
  x: z.boolean().default(false)
});
export type SourceSwitches = z.infer<typeof sourceSwitchesSchema>;

export const DEFAULT_SOURCE_SWITCHES: SourceSwitches = { hn: true, reddit: true, youtube: false, bluesky: true, x: false };

export const CONFIG_VERSION = 2;
const STRUCTURAL_GROUP_ID = "structural-ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withinTermLimit(group: unknown): unknown {
  return isRecord(group) && Array.isArray(group.terms) ? { ...group, terms: group.terms.slice(0, MAX_TERMS_PER_GROUP) } : group;
}

export function migrateConfig(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const groups = Array.isArray(raw.groups) ? raw.groups.map(withinTermLimit) : raw.groups;
  const version = typeof raw.version === "number" ? raw.version : 1;
  if (version >= CONFIG_VERSION) return { ...raw, groups };
  return {
    ...raw,
    version: CONFIG_VERSION,
    groups: Array.isArray(groups) ? groups.map((group) => (isRecord(group) && group.id === STRUCTURAL_GROUP_ID ? { ...group, canLead: false } : group)) : groups,
    sources: isRecord(raw.sources) ? { ...raw.sources, youtube: false } : raw.sources
  };
}

const listeningConfigShape = z.object({
  version: z.number().int().default(CONFIG_VERSION),
  groups: z.array(keywordGroupSchema).default(DEFAULT_KEYWORD_GROUPS),
  sources: sourceSwitchesSchema.default(DEFAULT_SOURCE_SWITCHES),
  autoScan: z.boolean().default(true)
});

export const listeningConfigSchema = z.preprocess(migrateConfig, listeningConfigShape);
export type ListeningConfig = z.infer<typeof listeningConfigShape>;

export const defaultListeningConfig: ListeningConfig = {
  version: CONFIG_VERSION,
  groups: DEFAULT_KEYWORD_GROUPS,
  sources: DEFAULT_SOURCE_SWITCHES,
  autoScan: true
};

const youtubeStateSchema = z.object({
  day: z.string().default(""),
  units: z.number().int().min(0).default(0),
  cursor: z.number().int().min(0).default(0)
});
export type YoutubeState = z.infer<typeof youtubeStateSchema>;

export const EMPTY_YOUTUBE_STATE: YoutubeState = { day: "", units: 0, cursor: 0 };

export const listeningStoreSchema = z.object({
  results: z.array(listeningResultSchema).default([]),
  lastScan: scanReportSchema.optional(),
  youtube: youtubeStateSchema.default(EMPTY_YOUTUBE_STATE),
  redditCursor: z.number().int().min(0).default(0)
});
export type ListeningStore = z.infer<typeof listeningStoreSchema>;

export const defaultListeningStore: ListeningStore = { results: [], youtube: EMPTY_YOUTUBE_STATE, redditCursor: 0 };

export type ListeningSnapshot = ListeningConfig & ListeningStore;

export const SCAN_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function isScanDue(state: { autoScan: boolean; lastScanAt: string | undefined; now: number }): boolean {
  if (!state.autoScan) return false;
  const last = state.lastScanAt ? Date.parse(state.lastScanAt) : Number.NaN;
  return !Number.isFinite(last) || state.now - last >= SCAN_INTERVAL_MS;
}

/** The most results kept. When full, the least valuable go first; see capResults. */
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
  category?: HitCategory;
  sentiment?: number;
  score?: number;
  reason?: string;
  classifiedBy?: "ai" | "heuristic";
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function excerptOf(text: string): string {
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

const MIN_FINGERPRINT_CHARS = 40;
const FINGERPRINT_CHARS = 120;

export function contentFingerprint(hit: Pick<ListeningHit, "title" | "excerpt">): string | null {
  const body = plainText(hit.excerpt);
  const title = plainText(hit.title);
  const basis = body.length >= MIN_FINGERPRINT_CHARS ? body : title.startsWith("Comment on: ") ? "" : title.replace(/^r\/\w+: /, "");
  const words = basis.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return words.length >= MIN_FINGERPRINT_CHARS ? words.slice(0, FINGERPRINT_CHARS) : null;
}

interface ResultIndex {
  byUrl: Map<string, string>;
  byPrint: Map<string, string>;
}

function indexResults(results: ListeningResult[]): ResultIndex {
  const index: ResultIndex = { byUrl: new Map(), byPrint: new Map() };
  for (const result of results) addToIndex(index, result);
  return index;
}

function addToIndex(index: ResultIndex, result: ListeningResult) {
  index.byUrl.set(normalizeResultUrl(result.url), result.id);
  for (const other of result.alsoOn) index.byUrl.set(normalizeResultUrl(other.url), result.id);
  const print = contentFingerprint(result);
  if (print && !index.byPrint.has(print)) index.byPrint.set(print, result.id);
}

function lookup(index: ResultIndex, hit: ListeningHit): string | undefined {
  const print = contentFingerprint(hit);
  return index.byUrl.get(normalizeResultUrl(hit.url)) ?? (print ? index.byPrint.get(print) : undefined);
}

export function splitNewHits(existing: ListeningResult[], hits: ListeningHit[]): ListeningHit[] {
  const index = indexResults(existing);
  const seenUrls = new Set<string>();
  const seenPrints = new Set<string>();
  const fresh: ListeningHit[] = [];
  for (const hit of hits) {
    const url = normalizeResultUrl(hit.url);
    const print = contentFingerprint(hit);
    if (lookup(index, hit) || seenUrls.has(url) || (print && seenPrints.has(print))) continue;
    seenUrls.add(url);
    if (print) seenPrints.add(print);
    fresh.push(hit);
  }
  return fresh;
}

/**
 * Fold a scan's hits into the stored results, one entry per url and per piece
 * of text. A url already on the list keeps its status and note - a scan never
 * resurrects something dismissed - and only gains any newly matched terms. The
 * same words found on another source are folded into the first result and
 * remembered in `alsoOn`. Returns how many were genuinely new.
 */
export function mergeResults(
  existing: ListeningResult[],
  hits: ListeningHit[],
  foundAt = new Date().toISOString()
): { results: ListeningResult[]; added: number } {
  const byId = new Map<string, ListeningResult>(existing.map((result) => [result.id, result]));
  const index = indexResults(existing);
  let added = 0;
  for (const hit of hits) {
    const knownId = lookup(index, hit);
    const known = knownId ? byId.get(knownId) : undefined;
    if (known) {
      const terms = [...new Set([...known.matchedTerms, ...hit.matchedTerms])];
      const sameUrl = normalizeResultUrl(known.url) === normalizeResultUrl(hit.url);
      const listed = known.alsoOn.some((other) => normalizeResultUrl(other.url) === normalizeResultUrl(hit.url));
      const alsoOn = sameUrl || listed ? known.alsoOn : [...known.alsoOn, { source: hit.source, url: hit.url }];
      if (terms.length !== known.matchedTerms.length || alsoOn.length !== known.alsoOn.length) {
        const next = { ...known, matchedTerms: terms, alsoOn };
        byId.set(known.id, next);
        addToIndex(index, next);
      }
      continue;
    }
    const result = listeningResultSchema.parse({
      ...hit,
      id: resultId(hit),
      status: "new",
      note: "",
      foundAt
    });
    byId.set(result.id, result);
    addToIndex(index, result);
    added += 1;
  }
  const results = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { results: capResults(results), added };
}

function keepRank(result: ListeningResult): number {
  if (result.status === "sent-to-outreach" || result.note) return 3;
  if (result.status === "dismissed") return 0;
  if (result.category === "lead") return 2;
  if (result.category === "noise") return 0;
  return 1;
}

function capResults(results: ListeningResult[]): ListeningResult[] {
  if (results.length <= MAX_RESULTS) return results;
  const overflow = results.length - MAX_RESULTS;
  const drop = new Set(
    [...results]
      .sort((a, b) => keepRank(a) - keepRank(b) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, overflow)
      .map((result) => result.id)
  );
  return results.filter((result) => !drop.has(result.id));
}

export function intentOfTerms(groups: KeywordGroup[], terms: string[]): ListeningIntent[] {
  const wanted = new Set(terms.map((term) => term.toLowerCase()));
  return [...new Set(groups.filter((group) => group.terms.some((term) => wanted.has(term.toLowerCase()))).map((group) => group.intent))];
}
