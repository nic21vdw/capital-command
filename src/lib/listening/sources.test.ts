import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultListeningConfig, SOURCE_NOTES, type ListeningConfig, type YoutubeState } from "@/lib/listening/model";
import { parseBlueskyResponse, parseYoutubeComments, parseYoutubeSearch } from "@/lib/listening/parsers";
import {
  REDDIT_SPACING_MS,
  REDDIT_TERMS_PER_SCAN,
  USER_AGENT,
  YOUTUBE_DAILY_UNITS_DEFAULT,
  YOUTUBE_MAX_COMMENT_CALLS,
  YOUTUBE_MAX_SEARCHES,
  blueskySearchUrl,
  collectScan,
  memoryLedger,
  scanFailed,
  youtubeSearchUrl,
  type ScanInput,
  type YoutubeLedger
} from "@/lib/listening/scan";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as unknown;
const TERMS = ["ETABS", "SAP2000", "RISA", "Tekla", "Revit", "structural engineering AI", "ai structural design"];
const NOW = new Date("2026-10-12T19:00:00.000Z");
const now = () => NOW;
const sleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function only(source: keyof ListeningConfig["sources"], terms = TERMS): ScanInput {
  return {
    groups: [{ id: "g", name: "G", intent: "competitor", canLead: true, terms }],
    sources: { hn: false, reddit: false, youtube: false, bluesky: false, x: false, [source]: true }
  };
}

type Call = { url: string; headers: Record<string, string> };

function recorder(handler: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return handler(url);
  });
  return { calls, fetch: fetcher as unknown as typeof fetch };
}

const isSearch = (url: string) => url.includes("/youtube/v3/search");
const isComments = (url: string) => url.includes("/youtube/v3/commentThreads");

describe("parsing YouTube", () => {
  it("keeps the videos a term matches and skips channel results", () => {
    const hits = parseYoutubeSearch(fixture("youtube-search.json"), TERMS);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: "youtube",
      title: "ETABS vs SAP2000 for a 12 storey frame",
      url: "https://www.youtube.com/watch?v=vid0001",
      author: "Struct Dev",
      createdAt: "2026-10-12T08:00:00Z"
    });
    expect(hits[0].matchedTerms).toEqual(["ETABS", "SAP2000"]);
    expect(hits[0].excerpt).toContain("Which one should I learn first");
  });

  it("keeps the comments that match, linked to the comment itself", () => {
    const hits = parseYoutubeComments(fixture("youtube-comments.json"), TERMS, { id: "vid0001", title: "ETABS vs SAP2000 for a 12 storey frame" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: "youtube",
      title: "Comment on: ETABS vs SAP2000 for a 12 storey frame",
      url: "https://www.youtube.com/watch?v=vid0001&lc=UgxAAA",
      author: "Dana",
      createdAt: "2026-10-12T09:30:00Z"
    });
    expect(hits[0].excerpt).toBe("Is there an AI tool that checks ETABS models? Has anyone tried one?");
    expect(hits[0].matchedTerms).toEqual(["ETABS"]);
  });

  it("throws on a response that is not a list rather than returning nothing", () => {
    expect(() => parseYoutubeSearch({ error: { code: 400 } }, TERMS)).toThrow(/items/);
    expect(() => parseYoutubeComments({}, TERMS, { id: "v", title: "t" })).toThrow(/items/);
  });
});

describe("scanning YouTube", () => {
  const withKey = async () => ({ key: "KEY123" });
  const fresh = (state: Partial<YoutubeState> = {}) => memoryLedger({ day: "", units: 0, cursor: 0, ...state });
  const BIG_BUDGET = 10_000;
  const at = (iso: string) => () => new Date(iso);

  function youtubeServer(overrides: { search?: () => Response; comments?: () => Response } = {}) {
    return recorder((url) => {
      if (isSearch(url)) return overrides.search?.() ?? jsonResponse(fixture("youtube-search.json"));
      if (isComments(url)) return overrides.comments?.() ?? jsonResponse(fixture("youtube-comments.json"));
      return jsonResponse({}, 404);
    });
  }

  it("makes one search per scan for the newest videos, batching terms into one query", async () => {
    const server = youtubeServer();
    const ledger = fresh();
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: ledger, youtubeDailyUnits: BIG_BUDGET });

    const searches = server.calls.filter((call) => isSearch(call.url));
    const comments = server.calls.filter((call) => isComments(call.url));
    expect(YOUTUBE_MAX_SEARCHES).toBe(1);
    expect(searches).toHaveLength(1);
    expect(comments.length).toBeLessThanOrEqual(YOUTUBE_MAX_COMMENT_CALLS);

    const search = new URL(searches[0].url);
    expect(search.searchParams.get("order")).toBe("date");
    expect(search.searchParams.get("type")).toBe("video");
    expect(search.searchParams.get("key")).toBe("KEY123");
    expect(search.searchParams.get("q")).toBe("ETABS|SAP2000|RISA|Tekla|Revit");
    expect(Date.parse(search.searchParams.get("publishedAfter")!)).toBeLessThan(NOW.getTime());

    const commentUrl = new URL(comments[0].url);
    expect(commentUrl.searchParams.get("videoId")).toBe("vid0001");
    expect(commentUrl.searchParams.get("searchTerms")).toBe("ETABS");

    expect(collected.sources[0].report).toMatchObject({ source: "youtube", ok: true, queries: searches.length + comments.length });
    expect(collected.sources[0].hits.map((hit) => hit.url)).toContain("https://www.youtube.com/watch?v=vid0001&lc=UgxAAA");
    expect(ledger.state()).toEqual({ day: "2026-10-12", units: 100 + comments.length, cursor: 1 });
  });

  it("rotates through the terms across scans instead of repeating the first ones", async () => {
    const ledger = fresh();
    const queries: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const server = youtubeServer();
      await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: ledger, youtubeDailyUnits: BIG_BUDGET });
      queries.push(...server.calls.filter((call) => isSearch(call.url)).map((call) => new URL(call.url).searchParams.get("q")));
    }
    expect(queries).toEqual(["ETABS|SAP2000|RISA|Tekla|Revit", '"structural engineering AI"|"ai structural design"', "ETABS|SAP2000|RISA|Tekla|Revit"]);
  });

  it("spreads the daily budget over the day: at 400 units a search opens up about every six hours, never all at midnight", async () => {
    const ledger = fresh();
    const attempt = async (iso: string) => {
      const server = youtubeServer();
      const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now: at(iso), youtubeAuth: withKey, youtubeLedger: ledger, youtubeDailyUnits: 400 });
      return { searches: server.calls.filter((call) => isSearch(call.url)).length, report: collected.sources[0].report };
    };

    expect((await attempt("2026-10-12T08:00:00.000Z")).searches).toBe(1);
    const early = await attempt("2026-10-12T10:00:00.000Z");
    expect(early.searches).toBe(0);
    expect(early.report).toMatchObject({ skipped: true, ok: true });
    expect(early.report.note).toMatch(/spread/i);
    expect((await attempt("2026-10-12T14:00:00.000Z")).searches).toBe(1);
    expect((await attempt("2026-10-12T16:00:00.000Z")).searches).toBe(0);
    expect((await attempt("2026-10-12T20:00:00.000Z")).searches).toBe(1);
    const spent = await attempt("2026-10-13T02:00:00.000Z");
    expect(spent.searches).toBe(0);
    expect(spent.report.note).toMatch(/budget/i);
    expect((await attempt("2026-10-13T08:00:00.000Z")).searches).toBe(1);
  });

  it("caps comment lookups when a search returns many matching videos", async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: { kind: "youtube#video", videoId: `many${i}` },
      snippet: { publishedAt: `2026-10-12T0${i}:00:00Z`, channelTitle: "c", title: `ETABS tips ${i}`, description: "" }
    }));
    const server = youtubeServer({ search: () => jsonResponse({ items }) });
    await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: fresh(), youtubeDailyUnits: BIG_BUDGET });
    expect(server.calls.filter((call) => isComments(call.url))).toHaveLength(YOUTUBE_MAX_COMMENT_CALLS);
  });

  it("uses the connected account's token when there is no API key", async () => {
    const server = youtubeServer();
    await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: async () => ({ token: "tok-1" }), youtubeLedger: fresh(), youtubeDailyUnits: BIG_BUDGET });
    expect(server.calls[0].headers.Authorization).toBe("Bearer tok-1");
    expect(new URL(server.calls[0].url).searchParams.has("key")).toBe(false);
  });

  it("defaults to a budget of 100 units a day, which is one search and no comment lookups", async () => {
    expect(YOUTUBE_DAILY_UNITS_DEFAULT).toBe(100);
    const server = youtubeServer();
    const ledger = fresh();
    await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: ledger });
    expect(server.calls.filter((call) => isSearch(call.url))).toHaveLength(1);
    expect(server.calls.filter((call) => isComments(call.url))).toHaveLength(0);
    expect(ledger.state().units).toBe(100);
  });

  it("stops for the day once the daily unit budget is spent, and says why instead of failing", async () => {
    const server = youtubeServer();
    const ledger = fresh({ day: "2026-10-12", units: YOUTUBE_DAILY_UNITS_DEFAULT - 50, cursor: 1 });
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: ledger });
    expect(server.calls).toHaveLength(0);
    expect(collected.sources[0].report).toMatchObject({ source: "youtube", skipped: true, queries: 0 });
    expect(collected.sources[0].report.note).toMatch(/budget/i);
    expect(ledger.state()).toEqual({ day: "2026-10-12", units: YOUTUBE_DAILY_UNITS_DEFAULT - 50, cursor: 1 });
    expect(scanFailed({ at: "x", sources: [{ ...collected.sources[0].report, added: 0 }] })).toBe(false);
  });

  it("starts the budget again at midnight Pacific", async () => {
    const server = youtubeServer();
    const ledger = fresh({ day: "2026-10-11", units: YOUTUBE_DAILY_UNITS_DEFAULT, cursor: 0 });
    await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: ledger });
    expect(server.calls.filter((call) => isSearch(call.url)).length).toBe(1);
    expect(ledger.state().day).toBe("2026-10-12");
  });

  it("debits the ledger before each search is sent, and sends nothing when the debit is refused", async () => {
    const events: string[] = [];
    const ledger = fresh();
    const spying: YoutubeLedger = {
      ...ledger,
      reserve: async (...args) => {
        events.push("debit");
        return ledger.reserve(...args);
      }
    };
    const server = recorder((url) => {
      events.push(isSearch(url) ? "search" : "comments");
      return isSearch(url) ? jsonResponse(fixture("youtube-search.json")) : jsonResponse(fixture("youtube-comments.json"));
    });
    await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: spying, youtubeDailyUnits: BIG_BUDGET });
    expect(events.slice(0, 4)).toEqual(["debit", "search", "debit", "comments"]);

    const refusing = recorder(() => jsonResponse({}));
    await collectScan(only("youtube"), {
      fetch: refusing.fetch,
      sleep,
      now,
      youtubeAuth: withKey,
      youtubeLedger: { ...ledger, reserve: async () => false },
      youtubeDailyUnits: BIG_BUDGET
    });
    expect(refusing.calls).toHaveLength(0);
  });

  it("sends nothing and reports a failure when the ledger cannot be written", async () => {
    const server = youtubeServer();
    const broken: YoutubeLedger = {
      ...fresh(),
      reserve: async () => {
        throw new Error("disk full");
      }
    };
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: broken, youtubeDailyUnits: BIG_BUDGET });
    expect(server.calls).toHaveLength(0);
    expect(collected.sources[0].report).toMatchObject({ ok: false });
    expect(collected.sources[0].report.error).toMatch(/disk full/);
  });

  it("reports an unconnected YouTube as skipped, without a request", async () => {
    const server = youtubeServer();
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: async () => null, youtubeLedger: fresh() });
    expect(server.calls).toHaveLength(0);
    expect(collected.sources[0].report).toMatchObject({ source: "youtube", skipped: true, ok: false });
    expect(collected.sources[0].report.error).toMatch(/not connected/i);
    expect(scanFailed({ at: "x", sources: [{ ...collected.sources[0].report, added: 0 }] })).toBe(false);
  });

  it("treats an exhausted Google quota as a failure and sits out the rest of the day", async () => {
    const server = youtubeServer({
      search: () => jsonResponse({ error: { code: 403, errors: [{ reason: "quotaExceeded" }], message: "quota" } }, 403)
    });
    const ledger = fresh();
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: ledger, youtubeDailyUnits: 400 });
    expect(collected.sources[0].report).toMatchObject({ ok: false, httpStatus: 403 });
    expect(collected.sources[0].report.error).toMatch(/quota/i);
    expect(ledger.state().units).toBeGreaterThanOrEqual(400);
  });

  it("keeps the videos when one video has its comments switched off", async () => {
    const server = youtubeServer({
      comments: () => jsonResponse({ error: { code: 403, errors: [{ reason: "commentsDisabled" }] } }, 403)
    });
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeLedger: fresh(), youtubeDailyUnits: BIG_BUDGET });
    expect(collected.sources[0].report.ok).toBe(true);
    expect(collected.sources[0].hits.map((hit) => hit.url)).toContain("https://www.youtube.com/watch?v=vid0001");
  });

  it("builds a search url with an OR query and the date filter", () => {
    const url = new URL(youtubeSearchUrl(["a b", "c"], "2026-10-09T19:00:00.000Z", "K"));
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/search");
    expect(url.searchParams.get("q")).toBe('"a b"|c');
    expect(url.searchParams.get("publishedAfter")).toBe("2026-10-09T19:00:00.000Z");
  });
});

describe("scanning Reddit", () => {
  const listing = { data: { children: [] } };
  const manyTerms = Array.from({ length: 22 }, (_, i) => `term${i}`);
  const queried = (calls: Call[]) => calls.map((call) => new URL(call.url).searchParams.get("q"));

  it("asks for six seconds between requests", async () => {
    expect(REDDIT_SPACING_MS).toBe(6000);
    const waits: number[] = [];
    const server = recorder(() => jsonResponse(listing));
    await collectScan(only("reddit", ["a1", "b2", "c3"]), { fetch: server.fetch, sleep: async (ms) => void waits.push(ms), now });
    expect(waits).toEqual([6000, 6000]);
  });

  it("searches a few terms a scan and starts each scan where the last stopped, so every term is searched within a day", async () => {
    const seen = new Set<string | null>();
    let cursor = 0;
    for (let scan = 0; scan < 3; scan += 1) {
      const server = recorder(() => jsonResponse(listing));
      const collected = await collectScan({ ...only("reddit", manyTerms), redditCursor: cursor }, { fetch: server.fetch, sleep, now });
      expect(server.calls).toHaveLength(REDDIT_TERMS_PER_SCAN);
      expect(collected.redditQueried).toBe(REDDIT_TERMS_PER_SCAN);
      queried(server.calls).forEach((term) => seen.add(term));
      cursor += collected.redditQueried ?? 0;
    }
    expect([...seen].sort()).toEqual([...manyTerms].sort());
  });

  it("starts from the stored cursor, wrapping around the list", async () => {
    const server = recorder(() => jsonResponse(listing));
    await collectScan({ ...only("reddit", manyTerms), redditCursor: 20 }, { fetch: server.fetch, sleep, now });
    expect(queried(server.calls).slice(0, 4)).toEqual(["term20", "term21", "term0", "term1"]);
  });

  it("waits out a short Retry-After and asks again", async () => {
    const waits: number[] = [];
    let first = true;
    const server = recorder(() => {
      if (first) {
        first = false;
        return new Response("{}", { status: 429, headers: { "Retry-After": "5" } });
      }
      return jsonResponse(listing);
    });
    const collected = await collectScan(only("reddit", ["a1", "b2"]), { fetch: server.fetch, sleep: async (ms) => void waits.push(ms), now });

    expect(waits).toEqual([5000, 6000]);
    expect(server.calls).toHaveLength(3);
    expect(collected.sources[0].report).toMatchObject({ ok: true });
    expect(collected.redditQueried).toBe(2);
  });

  it("stops and says how long Reddit asked for when the wait is long, without sleeping through it", async () => {
    const waits: number[] = [];
    const server = recorder(() => new Response("{}", { status: 429, headers: { "Retry-After": "600" } }));
    const collected = await collectScan(only("reddit", ["a1", "b2"]), { fetch: server.fetch, sleep: async (ms) => void waits.push(ms), now });

    expect(waits).toEqual([]);
    expect(server.calls).toHaveLength(1);
    expect(collected.sources[0].report).toMatchObject({ ok: false, httpStatus: 429 });
    expect(collected.sources[0].report.error).toMatch(/600 s/);
    expect(collected.redditQueried).toBe(0);
  });

  it("moves past a term that failed for any reason other than a 429, so one bad term cannot hold the rotation forever", async () => {
    const failures: [string, () => Response | Promise<Response>][] = [
      ["a server error", () => new Response("{}", { status: 500 })],
      ["a bad request", () => new Response("{}", { status: 400 })],
      ["an answer that is not JSON", () => new Response("<html>oops</html>", { status: 200 })]
    ];
    for (const [, failure] of failures) {
      let calls = 0;
      const server = recorder(() => {
        calls += 1;
        return calls === 1 ? jsonResponse(listing) : failure();
      });
      const collected = await collectScan(only("reddit", ["a1", "b2", "c3"]), { fetch: server.fetch, sleep, now });
      expect(collected.sources[0].report.ok).toBe(false);
      expect(collected.redditQueried).toBe(2);
    }
  });

  it("moves past a term whose request threw, such as a timeout", async () => {
    let calls = 0;
    const server = recorder(() => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse(listing);
    });
    const collected = await collectScan(only("reddit", ["a1", "b2"]), { fetch: server.fetch, sleep, now });
    expect(collected.redditQueried).toBe(1);
  });

  it("gives up after a second refusal in a row, and counts only the terms it did search", async () => {
    let calls = 0;
    const server = recorder(() => {
      calls += 1;
      return calls === 1 ? jsonResponse(listing) : new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
    });
    const collected = await collectScan(only("reddit", ["a1", "b2", "c3"]), { fetch: server.fetch, sleep, now });

    expect(collected.sources[0].report).toMatchObject({ ok: false, httpStatus: 429 });
    expect(collected.redditQueried).toBe(1);
  });
});

describe("parsing Bluesky", () => {
  const hits = parseBlueskyResponse(fixture("bluesky-search.json"), TERMS);

  it("cuts a long title on whole characters, so an emoji on the cut is kept or dropped and never split", () => {
    const text = `Revit ${"a".repeat(80)}\u{1F600}${"b".repeat(30)}`;
    const long = { posts: [{ uri: "at://did:plc:e/app.bsky.feed.post/3kemoji", author: { handle: "e.bsky.social" }, record: { text, createdAt: "2026-10-12T10:00:00.000Z" } }] };

    const [post] = parseBlueskyResponse(long, TERMS);

    expect([...post.title]).toHaveLength(90);
    expect(post.title.endsWith("...")).toBe(true);
    expect(post.title).toMatch(/\u{1F600}\.\.\.$/u);
    expect(post.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("cuts an excerpt on whole characters too", () => {
    const text = `Revit ${"a".repeat(270)}\u{1F600}${"b".repeat(30)}`;
    const long = { posts: [{ uri: "at://did:plc:e/app.bsky.feed.post/3kemoji", author: { handle: "e.bsky.social" }, record: { text, createdAt: "2026-10-12T10:00:00.000Z" } }] };

    const [post] = parseBlueskyResponse(long, TERMS);

    expect([...post.excerpt]).toHaveLength(280);
    expect(post.excerpt).toMatch(/\u{1F600}\.\.\.$/u);
    expect(post.excerpt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("keeps matching posts, links them on bsky.app, and skips authors who opted out of logged-out viewing", () => {
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: "bluesky",
      url: "https://bsky.app/profile/dana.bsky.social/post/3kabc111",
      author: "dana.bsky.social",
      createdAt: "2026-10-12T10:00:00.000Z"
    });
    expect(hits[0].excerpt).toContain("sanity check a Revit model");
    expect(hits[0].matchedTerms).toEqual(expect.arrayContaining(["Revit", "structural engineering AI"]));
  });

  it("throws on a response that is not a post list", () => {
    expect(() => parseBlueskyResponse({ error: "nope" }, TERMS)).toThrow(/posts/);
  });
});

describe("scanning Bluesky", () => {
  it("searches the public AppView newest first, since the lookback, with the descriptive User-Agent and no credentials", async () => {
    const server = recorder(() => jsonResponse(fixture("bluesky-search.json")));
    const collected = await collectScan(only("bluesky", ["Revit", "ETABS"]), { fetch: server.fetch, sleep, now });

    expect(server.calls).toHaveLength(2);
    const url = new URL(server.calls[0].url);
    expect(url.pathname).toBe("/xrpc/app.bsky.feed.searchPosts");
    expect(url.searchParams.get("q")).toBe("Revit");
    expect(url.searchParams.get("sort")).toBe("latest");
    expect(Date.parse(url.searchParams.get("since")!)).toBeLessThan(NOW.getTime());
    expect(server.calls[0].headers["User-Agent"]).toBe(USER_AGENT);
    expect(server.calls[0].headers).not.toHaveProperty("Authorization");
    expect(collected.sources[0].report).toMatchObject({ source: "bluesky", ok: true, queries: 2 });
    expect(collected.sources[0].hits.length).toBe(2);
  });

  it("moves to the other public host when the first refuses, and stays there", async () => {
    const server = recorder((url) => (url.startsWith("https://api.bsky.app") ? jsonResponse({}, 403) : jsonResponse(fixture("bluesky-search.json"))));
    const collected = await collectScan(only("bluesky", ["Revit", "ETABS", "RISA"]), { fetch: server.fetch, sleep, now });

    expect(server.calls.map((call) => new URL(call.url).host)).toEqual([
      "api.bsky.app",
      "public.api.bsky.app",
      "public.api.bsky.app",
      "public.api.bsky.app"
    ]);
    expect(collected.sources[0].report.ok).toBe(true);
  });

  it("reports the status when every host refuses, and stops asking", async () => {
    const server = recorder(() => jsonResponse({}, 403));
    const collected = await collectScan(only("bluesky", ["Revit", "ETABS", "RISA"]), { fetch: server.fetch, sleep, now });

    expect(collected.sources[0].report).toMatchObject({ source: "bluesky", ok: false, httpStatus: 403 });
    expect(collected.sources[0].report.error).toMatch(/403/);
    expect(server.calls).toHaveLength(2);
  });

  it("builds the search url", () => {
    const url = new URL(blueskySearchUrl("structural engineering AI", "https://api.bsky.app", "2026-10-09T19:00:00.000Z"));
    expect(url.searchParams.get("q")).toBe("structural engineering AI");
    expect(url.searchParams.get("limit")).toBe("25");
  });
});

describe("X", () => {
  it("says it needs X API access instead of searching, and is not counted as a failed scan", async () => {
    const server = recorder(() => jsonResponse({}));
    const collected = await collectScan(only("x"), { fetch: server.fetch, sleep, now });

    expect(server.calls).toHaveLength(0);
    expect(collected.sources[0].report).toMatchObject({ source: "x", ok: false, skipped: true, queries: 0, error: "Needs X API access" });
    expect(SOURCE_NOTES.x).toBe("Needs X API access");
    expect(scanFailed({ at: "x", sources: [{ ...collected.sources[0].report, added: 0 }] })).toBe(false);
  });

  it("is switched off by default", () => {
    expect(defaultListeningConfig.sources.x).toBe(false);
  });
});
