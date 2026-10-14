import {
  EMPTY_YOUTUBE_STATE,
  LISTENING_SOURCES,
  SOURCE_LABELS,
  SOURCE_NOTES,
  allTerms,
  mergeResults,
  parseHnResponse,
  parseRedditResponse,
  type KeywordGroup,
  type ListeningHit,
  type ListeningSource,
  type ListeningStore,
  type ScanReport,
  type SourceReport,
  type SourceSwitches,
  type YoutubeState
} from "@/lib/listening/model";
import { parseBlueskyResponse, parseYoutubeComments, parseYoutubeSearch } from "@/lib/listening/parsers";
import { quotaDate } from "@/lib/publisher/quota";

/**
 * One scan: every term of every keyword group against each enabled source,
 * folded into the stored results.
 *
 * Failure is reported, never swallowed. Each source ends with a report saying
 * how many queries went out and what came back, and a source that refused
 * (Reddit's 403 and 429 are the usual ones) says so with its HTTP status - the
 * page shows it and the CLI exits non-zero. One source failing never stops
 * the others. A source that was skipped on purpose (YouTube not connected, X
 * needing paid access, the YouTube budget spent) says why and is not a failure.
 */

export const USER_AGENT = "CoLateralMarketing-Listening/1.0 (private, local social listening tool; one scan at a time)";

const HN_ENDPOINT = "https://hn.algolia.com/api/v1/search_by_date";
const REDDIT_ENDPOINT = "https://www.reddit.com/search.json";
const BLUESKY_HOSTS = ["https://api.bsky.app", "https://public.api.bsky.app"];
const BLUESKY_PATH = "/xrpc/app.bsky.feed.searchPosts";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const DAY_SECONDS = 24 * 60 * 60;
const LOOKBACK_SECONDS = 7 * DAY_SECONDS;
const YOUTUBE_LOOKBACK_SECONDS = 3 * DAY_SECONDS;
const REDDIT_SPACING_MS = 2500;
const BLUESKY_SPACING_MS = 250;
const REQUEST_TIMEOUT_MS = 15_000;

export const YOUTUBE_MAX_SEARCHES = 2;
export const YOUTUBE_MAX_COMMENT_CALLS = 3;
export const YOUTUBE_TERMS_PER_QUERY = 5;
export const YOUTUBE_DAILY_UNITS_DEFAULT = 400;
const YOUTUBE_SEARCH_UNITS = 100;
const YOUTUBE_COMMENT_UNITS = 1;

export function hnSearchUrl(term: string, now = Date.now()): string {
  const params = new URLSearchParams({
    query: term,
    tags: "(story,comment)",
    hitsPerPage: "30",
    numericFilters: `created_at_i>${Math.floor(now / 1000) - LOOKBACK_SECONDS}`
  });
  return `${HN_ENDPOINT}?${params.toString()}`;
}

export function redditSearchUrl(term: string): string {
  const params = new URLSearchParams({ q: term, sort: "new", t: "week", limit: "25" });
  return `${REDDIT_ENDPOINT}?${params.toString()}`;
}

export function blueskySearchUrl(term: string, host: string, sinceIso: string): string {
  const params = new URLSearchParams({ q: term, sort: "latest", limit: "25", since: sinceIso });
  return `${host}${BLUESKY_PATH}?${params.toString()}`;
}

function youtubeQuery(terms: string[]): string {
  return terms.map((term) => (/\s/.test(term) ? `"${term}"` : term)).join("|");
}

export function youtubeSearchUrl(terms: string[], publishedAfter: string, key?: string): string {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    order: "date",
    maxResults: "15",
    publishedAfter,
    q: youtubeQuery(terms)
  });
  if (key) params.set("key", key);
  return `${YOUTUBE_API}/search?${params.toString()}`;
}

export function youtubeCommentsUrl(videoId: string, term: string, key?: string): string {
  const params = new URLSearchParams({
    part: "snippet",
    videoId,
    searchTerms: term,
    order: "time",
    maxResults: "20",
    textFormat: "plainText"
  });
  if (key) params.set("key", key);
  return `${YOUTUBE_API}/commentThreads?${params.toString()}`;
}

export class SourceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

const QUOTA_REASONS = /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/;

function explainStatus(source: ListeningSource, status: number, reason?: string): string {
  const name = SOURCE_LABELS[source];
  if (source === "youtube" && reason && QUOTA_REASONS.test(reason)) return `YouTube's API quota is used up (HTTP ${status}, ${reason}). It resets at midnight Pacific.`;
  if (status === 429) return `${name} is rate-limiting this machine (HTTP 429). Wait a few minutes and scan again.`;
  if (status === 403) {
    return source === "reddit"
      ? "Reddit refused the request (HTTP 403). It blocks some networks and unauthenticated clients outright; try again later or from another connection."
      : `${name} refused the request (HTTP 403).`;
  }
  return `${name} answered HTTP ${status}.`;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return `No answer within ${REQUEST_TIMEOUT_MS / 1000}s.`;
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message;
}

export type YoutubeAuth = { key?: string; token?: string };

export interface ScanDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  youtubeAuth?: () => Promise<YoutubeAuth | null>;
  youtubeDailyUnits?: number;
}

type SourceScan = { hits: ListeningHit[]; report: Omit<SourceReport, "added">; youtube?: YoutubeState };

async function defaultYoutubeAuth(): Promise<YoutubeAuth | null> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (key) return { key };
  try {
    const { youtubeAccessToken } = await import("@/lib/publisher/adapters/youtube");
    return { token: await youtubeAccessToken() };
  } catch {
    return null;
  }
}

function youtubeDailyUnits(deps: ScanDeps): number {
  if (deps.youtubeDailyUnits !== undefined) return deps.youtubeDailyUnits;
  const raw = process.env.YOUTUBE_LISTENING_DAILY_UNITS?.trim();
  const fromEnv = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : YOUTUBE_DAILY_UNITS_DEFAULT;
}

async function getJson(source: ListeningSource, url: string, fetcher: typeof fetch, extraHeaders: Record<string, string> = {}): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...extraHeaders },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store"
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason;
    throw new SourceHttpError(response.status, explainStatus(source, response.status, reason), reason);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${SOURCE_LABELS[source]} answered with something that is not JSON.`);
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function scanTerms(
  source: ListeningSource,
  terms: string[],
  spacingMs: number,
  sleep: (ms: number) => Promise<void>,
  query: (term: string) => Promise<ListeningHit[]>
): Promise<SourceScan> {
  const hits: ListeningHit[] = [];
  let queries = 0;
  for (const [index, term] of terms.entries()) {
    if (spacingMs > 0 && index > 0) await sleep(spacingMs);
    queries += 1;
    try {
      hits.push(...(await query(term)));
    } catch (error) {
      return {
        hits,
        report: {
          source,
          ok: false,
          queries,
          matched: hits.length,
          httpStatus: error instanceof SourceHttpError ? error.status : undefined,
          error: `${describeError(error)} (stopped at "${term}", ${queries} of ${terms.length} queries sent)`
        }
      };
    }
  }
  return { hits, report: { source, ok: true, queries, matched: hits.length } };
}

/**
 * Run every term against one source. Stops at the first failure: a 429 on the
 * third Reddit query means the next eight would be refused too, and hammering
 * a rate limit is how a scan turns into a ban.
 */
export async function scanSource(
  source: "hn" | "reddit" | "bluesky",
  terms: string[],
  deps: ScanDeps = {}
): Promise<{ hits: ListeningHit[]; report: Omit<SourceReport, "added"> }> {
  const fetcher = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const now = (deps.now ?? (() => new Date()))();

  if (source === "hn") {
    return scanTerms(source, terms, 0, sleep, async (term) => parseHnResponse(await getJson(source, hnSearchUrl(term, now.getTime()), fetcher), terms));
  }
  if (source === "reddit") {
    return scanTerms(source, terms, REDDIT_SPACING_MS, sleep, async (term) => parseRedditResponse(await getJson(source, redditSearchUrl(term), fetcher), terms));
  }

  const since = new Date(now.getTime() - LOOKBACK_SECONDS * 1000).toISOString();
  let host = 0;
  return scanTerms(source, terms, BLUESKY_SPACING_MS, sleep, async (term) => {
    for (;;) {
      try {
        return parseBlueskyResponse(await getJson(source, blueskySearchUrl(term, BLUESKY_HOSTS[host], since), fetcher), terms);
      } catch (error) {
        const refused = error instanceof SourceHttpError && (error.status === 401 || error.status === 403);
        if (!refused || host >= BLUESKY_HOSTS.length - 1) throw error;
        host += 1;
      }
    }
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function skippedYoutube(error: string | undefined, note: string | undefined): SourceScan {
  return { hits: [], report: { source: "youtube", ok: !error, skipped: true, queries: 0, matched: 0, error, note } };
}

async function scanYoutube(terms: string[], previous: YoutubeState, deps: ScanDeps): Promise<SourceScan> {
  const fetcher = deps.fetch ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  const auth = await (deps.youtubeAuth ?? defaultYoutubeAuth)();
  if (!auth) {
    return skippedYoutube("YouTube is not connected - set YOUTUBE_API_KEY, or connect YouTube in the Uploading Center.", undefined);
  }

  const budget = youtubeDailyUnits(deps);
  const day = quotaDate(now);
  const state: YoutubeState = { day, units: previous.day === day ? previous.units : 0, cursor: previous.cursor };
  const headers: Record<string, string> = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
  const chunks = chunk(terms, YOUTUBE_TERMS_PER_QUERY);
  const wanted = Math.min(YOUTUBE_MAX_SEARCHES, chunks.length);
  const publishedAfter = new Date(now.getTime() - YOUTUBE_LOOKBACK_SECONDS * 1000).toISOString();
  const start = state.cursor % chunks.length;
  const hits: ListeningHit[] = [];
  const videos = new Map<string, { id: string; title: string; term: string }>();
  let calls = 0;
  let searched = 0;

  const failure = (error: unknown): SourceScan => {
    if (error instanceof SourceHttpError && error.reason && QUOTA_REASONS.test(error.reason)) state.units = Math.max(state.units, budget);
    return {
      hits,
      youtube: state,
      report: {
        source: "youtube",
        ok: false,
        queries: calls,
        matched: hits.length,
        httpStatus: error instanceof SourceHttpError ? error.status : undefined,
        error: describeError(error)
      }
    };
  };

  for (let i = 0; i < wanted; i += 1) {
    if (state.units + YOUTUBE_SEARCH_UNITS > budget) break;
    state.units += YOUTUBE_SEARCH_UNITS;
    calls += 1;
    try {
      const url = youtubeSearchUrl(chunks[(start + i) % chunks.length], publishedAfter, auth.key);
      for (const hit of parseYoutubeSearch(await getJson("youtube", url, fetcher, headers), terms)) {
        hits.push(hit);
        const id = new URL(hit.url).searchParams.get("v") ?? "";
        if (id && !videos.has(id)) videos.set(id, { id, title: hit.title, term: hit.matchedTerms[0] });
      }
      searched += 1;
    } catch (error) {
      return failure(error);
    }
  }

  const newest = [...videos.values()].slice(0, YOUTUBE_MAX_COMMENT_CALLS);
  for (const video of newest) {
    if (state.units + YOUTUBE_COMMENT_UNITS > budget) break;
    state.units += YOUTUBE_COMMENT_UNITS;
    calls += 1;
    try {
      const json = await getJson("youtube", youtubeCommentsUrl(video.id, video.term, auth.key), fetcher, headers);
      hits.push(...parseYoutubeComments(json, terms, video));
    } catch (error) {
      if (error instanceof SourceHttpError && error.reason && QUOTA_REASONS.test(error.reason)) return failure(error);
    }
  }

  if (searched > 0) state.cursor = (start + searched) % chunks.length;
  const stoppedByBudget = searched < wanted;
  if (calls === 0) {
    return { ...skippedYoutube(undefined, `Daily YouTube budget of ${budget} units is used up; it starts again after midnight Pacific.`), youtube: state };
  }
  return {
    hits,
    youtube: state,
    report: {
      source: "youtube",
      ok: true,
      queries: calls,
      matched: hits.length,
      note: stoppedByBudget ? `Stopped early: the daily YouTube budget of ${budget} units was reached.` : undefined
    }
  };
}

function skippedX(): SourceScan {
  return { hits: [], report: { source: "x", ok: false, skipped: true, queries: 0, matched: 0, error: SOURCE_NOTES.x } };
}

export interface ScanInput {
  groups: KeywordGroup[];
  sources: SourceSwitches;
  youtube?: YoutubeState;
}

export interface CollectedScan {
  at: string;
  sources: { hits: ListeningHit[]; report: Omit<SourceReport, "added"> }[];
  youtube?: YoutubeState;
}

/**
 * Query every enabled source. Network only - nothing is merged or written
 * here, because a scan takes a while (Reddit is spaced out) and the list may
 * change underneath it; `applyScan` folds the hits into whatever is stored by
 * the time they arrive.
 */
export async function collectScan(input: ScanInput, deps: ScanDeps = {}): Promise<CollectedScan> {
  const terms = allTerms(input.groups);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const enabled = LISTENING_SOURCES.filter((source) => input.sources[source]);
  if (terms.length === 0) {
    return {
      at,
      sources: enabled.map((source) => ({
        hits: [],
        report: { source, ok: false, queries: 0, matched: 0, error: "No keyword terms to search for." }
      }))
    };
  }
  const scans = await Promise.all(
    enabled.map((source): Promise<SourceScan> => {
      if (source === "youtube") return scanYoutube(terms, input.youtube ?? EMPTY_YOUTUBE_STATE, deps);
      if (source === "x") return Promise.resolve(skippedX());
      return scanSource(source, terms, deps);
    })
  );
  return {
    at,
    sources: scans.map(({ hits, report }) => ({ hits, report })),
    youtube: scans.find((scan) => scan.youtube)?.youtube
  };
}

/** Fold a collected scan into the store as it is now. */
export function applyScan(
  store: ListeningStore,
  collected: CollectedScan,
  classified?: ScanReport["classified"]
): { store: ListeningStore; report: ScanReport } {
  let results = store.results;
  const reports: SourceReport[] = [];
  for (const { hits, report } of collected.sources) {
    const merged = mergeResults(results, hits, collected.at);
    results = merged.results;
    reports.push({ ...report, added: merged.added });
  }
  const report: ScanReport = { at: collected.at, sources: reports, classified };
  return { store: { ...store, results, lastScan: report, youtube: collected.youtube ?? store.youtube }, report };
}

export function scanFailed(report: ScanReport): boolean {
  return report.sources.length === 0 || report.sources.some((source) => !source.ok && !source.skipped);
}
