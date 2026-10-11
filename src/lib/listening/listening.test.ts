import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KEYWORD_GROUPS,
  MAX_RESULTS,
  allTerms,
  defaultListeningStore,
  mergeResults,
  normalizeResultUrl,
  parseHnResponse,
  parseRedditResponse,
  plainText,
  termMatches,
  type ListeningResult
} from "@/lib/listening/model";
import { applyScan, collectScan, hnSearchUrl, redditSearchUrl, scanFailed, USER_AGENT } from "@/lib/listening/scan";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as unknown;
const TERMS = allTerms(DEFAULT_KEYWORD_GROUPS);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("default keyword groups", () => {
  it("seeds the three intents with the agreed terms", () => {
    expect(DEFAULT_KEYWORD_GROUPS.map((group) => group.intent)).toEqual(["pain", "comparison", "pricing"]);
    expect(TERMS).toContain("multiple claude code");
    expect(TERMS).toContain("conductor app claude");
    expect(TERMS).toContain("one-time license ai");
    expect(TERMS).toHaveLength(11);
  });
});

describe("term matching", () => {
  it("matches the exact phrase case-insensitively", () => {
    expect(termMatches("Anyone found a good Cursor Alternative?", "cursor alternative")).toBe(true);
  });

  it("matches when every word of the term appears, in any order", () => {
    expect(termMatches("Using worktrees with Claude Code all week", "claude code worktrees")).toBe(true);
  });

  it("does not match on a partial overlap", () => {
    expect(termMatches("The history of the cursor", "cursor alternative")).toBe(false);
  });

  it("reads HN's HTML as plain text", () => {
    expect(plainText("a <i>Cursor</i> &amp; <p>Codex")).toBe("a Cursor & Codex");
  });
});

describe("parsing Hacker News", () => {
  const hits = parseHnResponse(fixture("hn-search.json"), TERMS);

  it("keeps only hits a term genuinely matches, and skips hits with no id", () => {
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://news.ycombinator.com/item?id=41000001",
      "https://news.ycombinator.com/item?id=41000002"
    ]);
  });

  it("points every hit at its HN item page and titles comments by their story", () => {
    const comment = hits[1];
    expect(comment.title).toBe("Comment on: Show HN: Yet another terminal");
    expect(comment.author).toBe("bob");
    expect(comment.createdAt).toBe("2026-10-10T16:30:00.000Z");
    expect(comment.matchedTerms).toEqual(["cursor alternative"]);
    expect(comment.excerpt).toContain("Codex & Claude");
  });

  it("records every term the text matches", () => {
    expect(hits[0].matchedTerms).toContain("multiple claude code");
  });

  it("throws on a response that is not a search result, rather than returning nothing", () => {
    expect(() => parseHnResponse({ message: "nope" }, TERMS)).toThrow(/hits/);
  });
});

describe("parsing Reddit", () => {
  const hits = parseRedditResponse(fixture("reddit-search.json"), TERMS);

  it("keeps matching posts and builds the permalink url", () => {
    expect(hits).toHaveLength(2);
    expect(hits[0].url).toBe("https://www.reddit.com/r/ClaudeAI/comments/abc123/claude_code_worktrees_are_great/");
    expect(hits[0].title).toBe("r/ClaudeAI: Claude Code worktrees are great but I have too many terminals");
    expect(hits[0].createdAt).toBe(new Date(1791640000 * 1000).toISOString());
  });

  it("matches across the title and the body", () => {
    expect(hits[0].matchedTerms).toEqual(
      expect.arrayContaining(["claude code worktrees", "parallel ai coding agents", "too many terminals ai agents", "claude code gui"])
    );
    expect(hits[1].matchedTerms).toEqual(["one-time license ai"]);
  });

  it("throws on a response that is not a listing", () => {
    expect(() => parseRedditResponse({ error: 403 }, TERMS)).toThrow(/listing/);
  });
});

describe("dedupe", () => {
  const hits = parseHnResponse(fixture("hn-search.json"), TERMS);

  it("normalizes protocol, www, old., trailing slash and fragment", () => {
    expect(normalizeResultUrl("https://old.reddit.com/r/x/comments/1/a/#c")).toBe(normalizeResultUrl("http://www.reddit.com/r/x/comments/1/a"));
  });

  it("adds each url once, however many times a scan returns it", () => {
    const { results, added } = mergeResults([], [...hits, ...hits], "2026-10-11T12:00:00.000Z");
    expect(added).toBe(2);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "new")).toBe(true);
  });

  it("never resets a triaged result and only adds new matched terms", () => {
    const first = mergeResults([], hits, "2026-10-11T12:00:00.000Z").results;
    const triaged: ListeningResult[] = first.map((result) => ({ ...result, status: "ignored", note: "not relevant" }));
    const again = mergeResults(triaged, [{ ...hits[0], url: `${hits[0].url}#reply`, matchedTerms: ["claude code gui"] }]);
    expect(again.added).toBe(0);
    const kept = again.results.find((result) => result.url === hits[0].url)!;
    expect(kept.status).toBe("ignored");
    expect(kept.note).toBe("not relevant");
    expect(kept.matchedTerms).toEqual(expect.arrayContaining(["multiple claude code", "claude code gui"]));
  });

  it("keeps the newest results first", () => {
    const { results } = mergeResults([], hits);
    expect(results[0].createdAt > results[1].createdAt).toBe(true);
  });

  it("caps the list, dropping old untouched results before marked ones", () => {
    const many: ListeningResult[] = Array.from({ length: MAX_RESULTS }, (_, i) => ({
      id: `hn-${i}`,
      source: "hn",
      title: `t${i}`,
      url: `https://news.ycombinator.com/item?id=${i}`,
      author: "",
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      excerpt: "",
      matchedTerms: [],
      status: i === 0 ? "replied" : "new",
      note: "",
      foundAt: "2026-10-01T12:00:00.000Z"
    }));
    const { results } = mergeResults(many, hits);
    expect(results).toHaveLength(MAX_RESULTS);
    expect(results.some((result) => result.id === "hn-0")).toBe(true);
    expect(results.some((result) => result.id === "hn-1")).toBe(false);
  });
});

describe("scanning", () => {
  const now = () => new Date("2026-10-11T12:00:00.000Z");
  const sleep = () => Promise.resolve();

  it("builds the requested endpoints", () => {
    expect(hnSearchUrl("cursor alternative", now().getTime())).toMatch(
      /^https:\/\/hn\.algolia\.com\/api\/v1\/search_by_date\?query=cursor\+alternative&tags=%28story%2Ccomment%29/
    );
    expect(redditSearchUrl("cursor alternative")).toBe("https://www.reddit.com/search.json?q=cursor+alternative&sort=new&t=week&limit=25");
  });

  it("queries both sources with a descriptive User-Agent and merges the results", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("algolia") ? jsonResponse(fixture("hn-search.json")) : jsonResponse(fixture("reddit-search.json"))
    );
    const collected = await collectScan(defaultListeningStore, { fetch: fetcher as unknown as typeof fetch, sleep, now });
    const { store, report } = applyScan(structuredClone(defaultListeningStore), collected);

    expect(fetcher).toHaveBeenCalledTimes(TERMS.length * 2);
    const headers = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(USER_AGENT);
    expect(report.sources.map((source) => [source.source, source.ok, source.added])).toEqual([
      ["hn", true, 2],
      ["reddit", true, 2]
    ]);
    expect(store.results).toHaveLength(4);
    expect(scanFailed(report)).toBe(false);
  });

  it("reports Reddit's 429 with its status, stops hammering it, and still keeps Hacker News", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("algolia") ? jsonResponse(fixture("hn-search.json")) : jsonResponse({ message: "Too Many Requests" }, 429)
    );
    const collected = await collectScan(defaultListeningStore, { fetch: fetcher as unknown as typeof fetch, sleep, now });
    const { report, store } = applyScan(structuredClone(defaultListeningStore), collected);

    const reddit = report.sources.find((source) => source.source === "reddit")!;
    expect(reddit.ok).toBe(false);
    expect(reddit.httpStatus).toBe(429);
    expect(reddit.queries).toBe(1);
    expect(reddit.error).toMatch(/rate-limiting/);
    expect(report.sources.find((source) => source.source === "hn")!.ok).toBe(true);
    expect(store.results).toHaveLength(2);
    expect(scanFailed(report)).toBe(true);
  });

  it("reports a 403 and a network failure instead of swallowing them", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("algolia")) throw new TypeError("fetch failed");
      return jsonResponse({}, 403);
    });
    const collected = await collectScan(defaultListeningStore, { fetch: fetcher as unknown as typeof fetch, sleep, now });
    const [hn, reddit] = collected.sources.map((source) => source.report);
    expect(hn.ok).toBe(false);
    expect(hn.error).toMatch(/fetch failed/);
    expect(reddit.httpStatus).toBe(403);
    expect(reddit.error).toMatch(/403/);
  });

  it("skips a source that is switched off", async () => {
    const fetcher = vi.fn(async () => jsonResponse(fixture("hn-search.json")));
    const collected = await collectScan(
      { ...defaultListeningStore, sources: { hn: true, reddit: false } },
      { fetch: fetcher as unknown as typeof fetch, sleep, now }
    );
    expect(collected.sources.map((source) => source.report.source)).toEqual(["hn"]);
    expect(fetcher).toHaveBeenCalledTimes(TERMS.length);
  });
});

describe("listening store", () => {
  it("starts from the seeded groups and persists updates", async () => {
    const initial = await readListeningStore();
    expect(initial.groups).toEqual(DEFAULT_KEYWORD_GROUPS);
    await updateListeningStore((store) => ({ ...store, sources: { hn: true, reddit: false } }));
    expect((await readListeningStore()).sources).toEqual({ hn: true, reddit: false });
  });
});
