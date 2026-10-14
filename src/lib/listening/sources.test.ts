import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultListeningConfig, SOURCE_NOTES, type ListeningConfig } from "@/lib/listening/model";
import { parseBlueskyResponse, parseYoutubeComments, parseYoutubeSearch } from "@/lib/listening/parsers";
import {
  USER_AGENT,
  YOUTUBE_DAILY_UNITS_DEFAULT,
  YOUTUBE_MAX_COMMENT_CALLS,
  YOUTUBE_MAX_SEARCHES,
  blueskySearchUrl,
  collectScan,
  scanFailed,
  youtubeSearchUrl
} from "@/lib/listening/scan";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as unknown;
const TERMS = ["ETABS", "SAP2000", "RISA", "Tekla", "Revit", "structural engineering AI", "ai structural design"];
const NOW = new Date("2026-10-12T19:00:00.000Z");
const now = () => NOW;
const sleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function only(source: keyof ListeningConfig["sources"], terms = TERMS): Pick<ListeningConfig, "groups" | "sources"> {
  return {
    groups: [{ id: "g", name: "G", intent: "competitor", terms }],
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

  function youtubeServer(overrides: { search?: () => Response; comments?: () => Response } = {}) {
    return recorder((url) => {
      if (isSearch(url)) return overrides.search?.() ?? jsonResponse(fixture("youtube-search.json"));
      if (isComments(url)) return overrides.comments?.() ?? jsonResponse(fixture("youtube-comments.json"));
      return jsonResponse({}, 404);
    });
  }

  it("asks for the newest videos, batches terms into one query, and stays inside the per-scan call budget", async () => {
    const server = youtubeServer();
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey });

    const searches = server.calls.filter((call) => isSearch(call.url));
    const comments = server.calls.filter((call) => isComments(call.url));
    expect(searches.length).toBeLessThanOrEqual(YOUTUBE_MAX_SEARCHES);
    expect(searches).toHaveLength(2);
    expect(comments.length).toBeLessThanOrEqual(YOUTUBE_MAX_COMMENT_CALLS);

    const first = new URL(searches[0].url);
    expect(first.searchParams.get("order")).toBe("date");
    expect(first.searchParams.get("type")).toBe("video");
    expect(first.searchParams.get("key")).toBe("KEY123");
    expect(first.searchParams.get("q")).toBe("ETABS|SAP2000|RISA|Tekla|Revit");
    expect(Date.parse(first.searchParams.get("publishedAfter")!)).toBeLessThan(NOW.getTime());
    expect(new URL(searches[1].url).searchParams.get("q")).toBe('"structural engineering AI"|"ai structural design"');

    const commentUrl = new URL(comments[0].url);
    expect(commentUrl.searchParams.get("videoId")).toBe("vid0001");
    expect(commentUrl.searchParams.get("searchTerms")).toBe("ETABS");

    const [youtube] = collected.sources;
    expect(youtube.report).toMatchObject({ source: "youtube", ok: true, queries: searches.length + comments.length });
    expect(youtube.hits.map((hit) => hit.url)).toContain("https://www.youtube.com/watch?v=vid0001&lc=UgxAAA");
    expect(collected.youtube).toEqual({ day: "2026-10-12", units: searches.length * 100 + comments.length, cursor: 0 });
  });

  it("rotates through the terms across scans instead of repeating the first ones", async () => {
    const terms = [...TERMS, "a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
    const server = youtubeServer();
    const collected = await collectScan(
      { ...only("youtube", terms), youtube: { day: "2026-10-12", units: 0, cursor: 0 } },
      { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeDailyUnits: 10_000 }
    );
    expect(collected.youtube?.cursor).toBe(2);
    const next = youtubeServer();
    await collectScan(
      { ...only("youtube", terms), youtube: collected.youtube },
      { fetch: next.fetch, sleep, now, youtubeAuth: withKey, youtubeDailyUnits: 10_000 }
    );
    const queries = next.calls.filter((call) => isSearch(call.url)).map((call) => new URL(call.url).searchParams.get("q"));
    expect(queries).toEqual(["d4|e5|f6|g7|h8", "ETABS|SAP2000|RISA|Tekla|Revit"]);
  });

  it("caps comment lookups when a search returns many matching videos", async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: { kind: "youtube#video", videoId: `many${i}` },
      snippet: { publishedAt: `2026-10-12T0${i}:00:00Z`, channelTitle: "c", title: `ETABS tips ${i}`, description: "" }
    }));
    const server = youtubeServer({ search: () => jsonResponse({ items }) });
    await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey, youtubeDailyUnits: 10_000 });
    expect(server.calls.filter((call) => isComments(call.url))).toHaveLength(YOUTUBE_MAX_COMMENT_CALLS);
  });

  it("uses the connected account's token when there is no API key", async () => {
    const server = youtubeServer();
    await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: async () => ({ token: "tok-1" }) });
    expect(server.calls[0].headers.Authorization).toBe("Bearer tok-1");
    expect(new URL(server.calls[0].url).searchParams.has("key")).toBe(false);
  });

  it("stops for the day once the daily unit budget is spent, and says why instead of failing", async () => {
    const server = youtubeServer();
    const collected = await collectScan(
      { ...only("youtube"), youtube: { day: "2026-10-12", units: YOUTUBE_DAILY_UNITS_DEFAULT - 50, cursor: 1 } },
      { fetch: server.fetch, sleep, now, youtubeAuth: withKey }
    );
    expect(server.calls).toHaveLength(0);
    expect(collected.sources[0].report).toMatchObject({ source: "youtube", skipped: true, queries: 0 });
    expect(collected.sources[0].report.note).toMatch(/budget/i);
    expect(collected.youtube).toEqual({ day: "2026-10-12", units: YOUTUBE_DAILY_UNITS_DEFAULT - 50, cursor: 1 });
    expect(scanFailed({ at: "x", sources: [{ ...collected.sources[0].report, added: 0 }] })).toBe(false);
  });

  it("starts the budget again at midnight Pacific", async () => {
    const server = youtubeServer();
    const collected = await collectScan(
      { ...only("youtube"), youtube: { day: "2026-10-11", units: YOUTUBE_DAILY_UNITS_DEFAULT, cursor: 0 } },
      { fetch: server.fetch, sleep, now, youtubeAuth: withKey }
    );
    expect(server.calls.filter((call) => isSearch(call.url)).length).toBeGreaterThan(0);
    expect(collected.youtube?.day).toBe("2026-10-12");
  });

  it("reports an unconnected YouTube as skipped, without a request", async () => {
    const server = youtubeServer();
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: async () => null });
    expect(server.calls).toHaveLength(0);
    expect(collected.sources[0].report).toMatchObject({ source: "youtube", skipped: true, ok: false });
    expect(collected.sources[0].report.error).toMatch(/not connected/i);
    expect(scanFailed({ at: "x", sources: [{ ...collected.sources[0].report, added: 0 }] })).toBe(false);
  });

  it("treats an exhausted Google quota as a failure and sits out the rest of the day", async () => {
    const server = youtubeServer({
      search: () => jsonResponse({ error: { code: 403, errors: [{ reason: "quotaExceeded" }], message: "quota" } }, 403)
    });
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey });
    expect(collected.sources[0].report).toMatchObject({ ok: false, httpStatus: 403 });
    expect(collected.sources[0].report.error).toMatch(/quota/i);
    expect(collected.youtube?.units).toBeGreaterThanOrEqual(YOUTUBE_DAILY_UNITS_DEFAULT);
  });

  it("keeps the videos when one video has its comments switched off", async () => {
    const server = youtubeServer({
      comments: () => jsonResponse({ error: { code: 403, errors: [{ reason: "commentsDisabled" }] } }, 403)
    });
    const collected = await collectScan(only("youtube"), { fetch: server.fetch, sleep, now, youtubeAuth: withKey });
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

describe("parsing Bluesky", () => {
  const hits = parseBlueskyResponse(fixture("bluesky-search.json"), TERMS);

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
