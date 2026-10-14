import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KEYWORD_GROUPS,
  MAX_RESULTS,
  RESULT_STATUSES,
  allTerms,
  contentFingerprint,
  defaultListeningConfig,
  mergeResults,
  normalizeResultUrl,
  parseHnResponse,
  parseRedditResponse,
  plainText,
  splitNewHits,
  termMatches,
  type ListeningHit,
  type ListeningResult
} from "@/lib/listening/model";
import { applyScan, collectScan, hnSearchUrl, redditSearchUrl, scanFailed, USER_AGENT } from "@/lib/listening/scan";
import { readListeningConfig, updateListeningConfig } from "@/lib/listening/config";
import { readListeningStore } from "@/lib/listening/store";
import { dataPath } from "@/lib/paths";
import * as atomicJson from "@/lib/storage/atomic-json";

vi.mock("@/lib/storage/atomic-json", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/storage/atomic-json")>();
  return { ...original, atomicWriteJson: vi.fn(original.atomicWriteJson) };
});

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as unknown;
const TERMS = allTerms(DEFAULT_KEYWORD_GROUPS);
const HN_AND_REDDIT = { ...defaultListeningConfig, sources: { hn: true, reddit: true, youtube: false, bluesky: false, x: false } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function resultOf(overrides: Partial<ListeningResult> & { id: string }): ListeningResult {
  return {
    source: "hn",
    title: overrides.id,
    url: `https://news.ycombinator.com/item?id=${overrides.id}`,
    author: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    excerpt: "",
    matchedTerms: [],
    status: "new",
    note: "",
    foundAt: "2026-10-01T12:00:00.000Z",
    category: "mention",
    sentiment: 0,
    score: 0,
    reason: "",
    classifiedBy: "heuristic",
    alsoOn: [],
    ...overrides
  };
}

describe("default keyword groups", () => {
  it("watch the product, the competitors and structural engineering AI, and keep the original agent-workspace terms", () => {
    expect(DEFAULT_KEYWORD_GROUPS.map((group) => group.intent)).toEqual(
      expect.arrayContaining(["brand", "competitor", "pain", "comparison", "pricing"])
    );
    for (const term of ["ETABS", "SAP2000", "RISA", "Tekla", "Revit", "structural engineering AI", "multiple claude code", "one-time license ai"]) {
      expect(TERMS.map((entry) => entry.toLowerCase())).toContain(term.toLowerCase());
    }
  });

  it("never searches the bare word collateral, which is mostly loans", () => {
    expect(TERMS.map((term) => term.toLowerCase())).not.toContain("colateral");
    expect(TERMS.map((term) => term.toLowerCase())).not.toContain("collateral");
  });

  it("gives every hit one of four statuses", () => {
    expect(RESULT_STATUSES).toEqual(["new", "seen", "sent-to-outreach", "dismissed"]);
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
    const triaged: ListeningResult[] = first.map((result) => ({ ...result, status: "dismissed", note: "not relevant" }));
    const again = mergeResults(triaged, [{ ...hits[0], url: `${hits[0].url}#reply`, matchedTerms: ["claude code gui"] }]);
    expect(again.added).toBe(0);
    const kept = again.results.find((result) => result.url === hits[0].url)!;
    expect(kept.status).toBe("dismissed");
    expect(kept.note).toBe("not relevant");
    expect(kept.matchedTerms).toEqual(expect.arrayContaining(["multiple claude code", "claude code gui"]));
  });

  it("keeps the newest results first", () => {
    const { results } = mergeResults([], hits);
    expect(results[0].createdAt > results[1].createdAt).toBe(true);
  });

  describe("across sources", () => {
    const text = "Anyone know a structural engineering AI that can sanity check a Revit model? Drowning in RFIs this week.";
    const reddit: ListeningHit = {
      source: "reddit",
      title: "r/StructuralEngineering: Revit model checking",
      url: "https://www.reddit.com/r/StructuralEngineering/comments/zzz111/revit_model_checking/",
      author: "dana",
      createdAt: "2026-10-12T10:00:00.000Z",
      excerpt: text,
      matchedTerms: ["Revit"]
    };
    const bluesky: ListeningHit = {
      source: "bluesky",
      title: text.slice(0, 80),
      url: "https://bsky.app/profile/dana.bsky.social/post/3kabc111",
      author: "dana.bsky.social",
      createdAt: "2026-10-12T10:05:00.000Z",
      excerpt: text,
      matchedTerms: ["structural engineering AI"]
    };

    it("fingerprints the same words the same way whatever the markup or case", () => {
      expect(contentFingerprint({ title: "x", excerpt: `<p>${text.toUpperCase()}</p>` })).toBe(contentFingerprint({ title: "x", excerpt: text }));
      expect(contentFingerprint({ title: "short", excerpt: "tiny" })).toBeNull();
    });

    it("keeps one result for text posted on two sources and remembers where else it appeared", () => {
      const { results, added } = mergeResults([], [reddit, bluesky], "2026-10-12T12:00:00.000Z");
      expect(added).toBe(1);
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe("reddit");
      expect(results[0].alsoOn).toEqual([{ source: "bluesky", url: bluesky.url }]);
      expect(results[0].matchedTerms).toEqual(expect.arrayContaining(["Revit", "structural engineering AI"]));
    });

    it("catches a copy that turns up in a later scan, without counting it as new", () => {
      const first = mergeResults([], [reddit], "2026-10-12T12:00:00.000Z").results;
      const later = mergeResults(first, [bluesky], "2026-10-12T14:00:00.000Z");
      expect(later.added).toBe(0);
      expect(later.results).toHaveLength(1);
      expect(later.results[0].alsoOn.map((entry) => entry.source)).toEqual(["bluesky"]);
    });

    it("lists only the hits that are genuinely new, so nothing already stored is classified again", () => {
      const stored = mergeResults([], [reddit], "2026-10-12T12:00:00.000Z").results;
      const other = { ...bluesky, url: "https://bsky.app/profile/lee.bsky.social/post/3kzzz999", excerpt: "A completely different post about SAP2000 pricing." };
      expect(splitNewHits(stored, [reddit, bluesky, other])).toEqual([other]);
    });
  });

  describe("the cap", () => {
    it("holds the list at the cap, dropping dismissed and low-value results before leads and anything sent to outreach", () => {
      const many: ListeningResult[] = Array.from({ length: MAX_RESULTS }, (_, i) =>
        resultOf({
          id: `hn-${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
          status: i === 0 ? "sent-to-outreach" : i === 1 ? "new" : i === 2 ? "dismissed" : "new",
          category: i === 1 ? "lead" : "noise"
        })
      );
      const extra: ListeningHit = {
        source: "hn",
        title: "fresh",
        url: "https://news.ycombinator.com/item?id=99999999",
        author: "",
        createdAt: "2027-01-01T00:00:00.000Z",
        excerpt: "",
        matchedTerms: ["Revit"]
      };
      const { results } = mergeResults(many, [extra, { ...extra, url: `${extra.url}0` }]);
      expect(results).toHaveLength(MAX_RESULTS);
      const ids = new Set(results.map((result) => result.id));
      expect(ids.has("hn-0")).toBe(true);
      expect(ids.has("hn-1")).toBe(true);
      expect(ids.has("hn-2")).toBe(false);
      expect(ids.has("hn-3")).toBe(false);
    });

    it("protects a result Nic wrote a note on", () => {
      const many: ListeningResult[] = Array.from({ length: MAX_RESULTS }, (_, i) =>
        resultOf({
          id: `hn-${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
          category: "noise",
          note: i === 0 ? "follow up" : ""
        })
      );
      const { results } = mergeResults(many, [
        { source: "hn", title: "fresh", url: "https://news.ycombinator.com/item?id=88888888", author: "", createdAt: "2027-01-01T00:00:00.000Z", excerpt: "", matchedTerms: ["Revit"] }
      ]);
      expect(results).toHaveLength(MAX_RESULTS);
      expect(results.some((result) => result.id === "hn-0")).toBe(true);
      expect(results.some((result) => result.id === "hn-1")).toBe(false);
    });
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
    const collected = await collectScan(HN_AND_REDDIT, { fetch: fetcher as unknown as typeof fetch, sleep, now });
    const { store, report } = applyScan({ results: [], youtube: { day: "", units: 0, cursor: 0 } }, collected);

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
    const collected = await collectScan(HN_AND_REDDIT, { fetch: fetcher as unknown as typeof fetch, sleep, now });
    const { report, store } = applyScan({ results: [], youtube: { day: "", units: 0, cursor: 0 } }, collected);

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
    const collected = await collectScan(HN_AND_REDDIT, { fetch: fetcher as unknown as typeof fetch, sleep, now });
    const [hn, reddit] = collected.sources.map((source) => source.report);
    expect(hn.ok).toBe(false);
    expect(hn.error).toMatch(/fetch failed/);
    expect(reddit.httpStatus).toBe(403);
    expect(reddit.error).toMatch(/403/);
  });

  it("skips a source that is switched off", async () => {
    const fetcher = vi.fn(async () => jsonResponse(fixture("hn-search.json")));
    const collected = await collectScan(
      { ...HN_AND_REDDIT, sources: { ...HN_AND_REDDIT.sources, reddit: false } },
      { fetch: fetcher as unknown as typeof fetch, sleep, now }
    );
    expect(collected.sources.map((source) => source.report.source)).toEqual(["hn"]);
    expect(fetcher).toHaveBeenCalledTimes(TERMS.length);
  });
});

describe("listening config", () => {
  it("starts from the defaults and saves edits to data/listening/config.json through the shared atomic writer", async () => {
    const initial = await readListeningConfig();
    expect(initial.groups).toEqual(DEFAULT_KEYWORD_GROUPS);
    expect(initial.autoScan).toBe(true);
    expect(initial.sources.x).toBe(false);

    await updateListeningConfig((config) => ({
      ...config,
      groups: [...config.groups, { id: "mine", name: "Mine", intent: "pain", terms: ["my own term"] }],
      sources: { ...config.sources, reddit: false }
    }));

    const file = dataPath("listening", "config.json");
    expect(atomicJson.atomicWriteJson).toHaveBeenCalledWith(file, expect.anything());
    const onDisk = JSON.parse(await readFile(file, "utf8")) as { groups: { id: string }[]; sources: { reddit: boolean } };
    expect(onDisk.groups.map((group) => group.id)).toContain("mine");
    expect(onDisk.sources.reddit).toBe(false);
    expect((await readListeningConfig()).sources.reddit).toBe(false);
  });

  it("keeps hits in their own file, apart from the keyword config", async () => {
    const store = await readListeningStore();
    expect(store.results).toEqual([]);
    expect(store).not.toHaveProperty("groups");
  });
});
