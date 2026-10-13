import {
  allTerms,
  mergeResults,
  parseHnResponse,
  parseRedditResponse,
  type ListeningHit,
  type ListeningSource,
  type ListeningStore,
  type ScanReport,
  type SourceReport
} from "@/lib/listening/model";

/**
 * One "Scan now": every term of every keyword group against each enabled
 * source, folded into the stored results.
 *
 * Failure is reported, never swallowed. Each source ends with a report saying
 * how many queries went out and what came back, and a source that refused
 * (Reddit's 403 and 429 are the usual ones) says so with its HTTP status — the
 * page shows it and the CLI exits non-zero. One source failing never stops
 * the other.
 */

export const USER_AGENT = "CoLateralMarketing-Listening/1.0 (private, local social listening tool; one scan at a time)";

const HN_ENDPOINT = "https://hn.algolia.com/api/v1/search_by_date";
const REDDIT_ENDPOINT = "https://www.reddit.com/search.json";
const LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
/** Reddit allows unauthenticated clients only a handful of requests a minute. */
const REDDIT_SPACING_MS = 2500;
const REQUEST_TIMEOUT_MS = 15_000;

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

export class SourceHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

function explainStatus(source: ListeningSource, status: number): string {
  const name = source === "hn" ? "Hacker News" : "Reddit";
  if (status === 429) return `${name} is rate-limiting this machine (HTTP 429). Wait a few minutes and scan again.`;
  if (status === 403) {
    return source === "reddit"
      ? "Reddit refused the request (HTTP 403). It blocks some networks and unauthenticated clients outright; try again later or from another connection."
      : `${name} refused the request (HTTP 403).`;
  }
  return `${name} answered HTTP ${status}.`;
}

/** "fetch failed" alone says nothing; the reason (DNS, refused, timeout, TLS) is on the cause. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return `No answer within ${REQUEST_TIMEOUT_MS / 1000}s.`;
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message;
}

export interface ScanDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

async function getJson(source: ListeningSource, url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store"
  });
  if (!response.ok) throw new SourceHttpError(response.status, explainStatus(source, response.status));
  try {
    return await response.json();
  } catch {
    throw new Error(`${source === "hn" ? "Hacker News" : "Reddit"} answered with something that is not JSON.`);
  }
}

/**
 * Run every term against one source. Stops at the first failure: a 429 on the
 * third Reddit query means the next eight would be refused too, and hammering
 * a rate limit is how a scan turns into a ban.
 */
export async function scanSource(
  source: ListeningSource,
  terms: string[],
  deps: ScanDeps = {}
): Promise<{ hits: ListeningHit[]; report: Omit<SourceReport, "added"> }> {
  const fetcher = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = (deps.now ?? (() => new Date()))();
  const hits: ListeningHit[] = [];
  let queries = 0;

  for (const [index, term] of terms.entries()) {
    if (source === "reddit" && index > 0) await sleep(REDDIT_SPACING_MS);
    const url = source === "hn" ? hnSearchUrl(term, now.getTime()) : redditSearchUrl(term);
    queries += 1;
    try {
      const json = await getJson(source, url, fetcher);
      hits.push(...(source === "hn" ? parseHnResponse(json, terms) : parseRedditResponse(json, terms)));
    } catch (error) {
      const message = describeError(error);
      return {
        hits,
        report: {
          source,
          ok: false,
          queries,
          matched: hits.length,
          httpStatus: error instanceof SourceHttpError ? error.status : undefined,
          error: `${message} (stopped at "${term}", ${queries} of ${terms.length} queries sent)`
        }
      };
    }
  }
  return { hits, report: { source, ok: true, queries, matched: hits.length } };
}

export interface CollectedScan {
  at: string;
  sources: { hits: ListeningHit[]; report: Omit<SourceReport, "added"> }[];
}

/**
 * Query every enabled source. Network only — nothing is merged or written
 * here, because a scan takes a while (Reddit is spaced out) and the list may
 * change underneath it; `applyScan` folds the hits into whatever is stored by
 * the time they arrive.
 */
export async function collectScan(store: Pick<ListeningStore, "groups" | "sources">, deps: ScanDeps = {}): Promise<CollectedScan> {
  const terms = allTerms(store.groups);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const enabled = (["hn", "reddit"] as const).filter((source) => store.sources[source]);
  if (terms.length === 0) {
    return {
      at,
      sources: enabled.map((source) => ({
        hits: [],
        report: { source, ok: false, queries: 0, matched: 0, error: "No keyword terms to search for." }
      }))
    };
  }
  // Sources run side by side; they share nothing but the merge at the end.
  return { at, sources: await Promise.all(enabled.map((source) => scanSource(source, terms, deps))) };
}

/** Fold a collected scan into the store as it is now. */
export function applyScan(store: ListeningStore, collected: CollectedScan): { store: ListeningStore; report: ScanReport } {
  let results = store.results;
  const reports: SourceReport[] = [];
  for (const { hits, report } of collected.sources) {
    const merged = mergeResults(results, hits, collected.at);
    results = merged.results;
    reports.push({ ...report, added: merged.added });
  }
  const report: ScanReport = { at: collected.at, sources: reports };
  return { store: { ...store, results, lastScan: report }, report };
}

export function scanFailed(report: ScanReport): boolean {
  return report.sources.length === 0 || report.sources.some((source) => !source.ok);
}
