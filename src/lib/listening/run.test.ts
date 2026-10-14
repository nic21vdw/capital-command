import { readFileSync } from "node:fs";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIGH_LEAD_SCORE, isHighLead, leadSummary } from "@/lib/listening/leads";
import { updateListeningConfig, readListeningConfig } from "@/lib/listening/config";
import type { ListeningResult } from "@/lib/listening/model";
import { runListeningScan } from "@/lib/listening/run";
import { SCAN_INTERVAL_MS, isScanDue, scheduledScanOnce } from "@/lib/listening/schedule";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { dataPath } from "@/lib/paths";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as unknown;
const NOW = new Date("2026-10-12T14:00:00.000Z");
const now = () => NOW;
const sleep = () => Promise.resolve();
const noAi = async () => null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const sharedText = "Anyone know a structural engineering AI that can sanity check a Revit model? Drowning in RFIs.";

const redditListing = {
  data: {
    children: [
      {
        data: {
          permalink: "/r/StructuralEngineering/comments/zzz111/revit_model_checking/",
          title: "Revit model checking",
          selftext: sharedText,
          subreddit: "StructuralEngineering",
          author: "dana",
          created_utc: Date.parse("2026-10-12T10:00:00.000Z") / 1000
        }
      }
    ]
  }
};

async function configure(sources: Partial<Record<"hn" | "reddit" | "youtube" | "bluesky" | "x", boolean>>) {
  await updateListeningConfig((config) => ({
    ...config,
    groups: [
      { id: "ai", name: "Structural AI", intent: "pain", terms: ["structural engineering AI"] },
      { id: "comp", name: "Competitors", intent: "competitor", terms: ["Revit"] }
    ],
    sources: { hn: false, reddit: false, youtube: false, bluesky: false, x: false, ...sources }
  }));
}

beforeEach(async () => {
  await rm(dataPath("listening.json"), { force: true });
  await rm(dataPath("listening"), { recursive: true, force: true });
});

describe("one scan, end to end", () => {
  it("collects from each source, keeps one copy of text posted twice, classifies what is new and counts the new leads", async () => {
    await configure({ reddit: true, bluesky: true });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("reddit.com") ? jsonResponse(redditListing) : jsonResponse(fixture("bluesky-search.json"))
    );
    const runAi = vi.fn(noAi);

    const outcome = await runListeningScan({ fetch: fetcher as unknown as typeof fetch, sleep, now, runAi });

    expect(outcome.joined).toBe(false);
    expect(outcome.report.sources.map((source) => [source.source, source.ok])).toEqual([
      ["reddit", true],
      ["bluesky", true]
    ]);
    expect(outcome.classified).toEqual({ ai: 0, heuristic: 1 });
    expect(outcome.newLeads).toBe(1);

    const store = await readListeningStore();
    expect(store.results).toHaveLength(1);
    expect(store.results[0]).toMatchObject({ source: "reddit", status: "new", category: "lead", classifiedBy: "heuristic" });
    expect(store.results[0].score).toBeGreaterThanOrEqual(HIGH_LEAD_SCORE);
    expect(store.results[0].alsoOn).toEqual([{ source: "bluesky", url: "https://bsky.app/profile/dana.bsky.social/post/3kabc111" }]);
    expect(store.lastScan?.at).toBe(NOW.toISOString());
    expect(leadSummary(store.results).newLeads).toBe(1);
  });

  it("does not ask the model about hits it has already stored", async () => {
    await configure({ reddit: true });
    const fetcher = vi.fn(async () => jsonResponse(redditListing));
    const runAi = vi.fn(noAi);
    const deps = { fetch: fetcher as unknown as typeof fetch, sleep, now, runAi };

    await runListeningScan(deps);
    expect(runAi).toHaveBeenCalledTimes(1);
    const second = await runListeningScan(deps);

    expect(runAi).toHaveBeenCalledTimes(1);
    expect(second.newLeads).toBe(0);
    expect((await readListeningStore()).results).toHaveLength(1);
  });

  it("keeps what a failing source did not stop, and reports the failure", async () => {
    await configure({ reddit: true, bluesky: true });
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("reddit.com") ? jsonResponse({}, 429) : jsonResponse(fixture("bluesky-search.json"))
    );
    const outcome = await runListeningScan({ fetch: fetcher as unknown as typeof fetch, sleep, now, runAi: noAi });

    expect(outcome.report.sources.find((source) => source.source === "reddit")).toMatchObject({ ok: false, httpStatus: 429 });
    expect((await readListeningStore()).results).toHaveLength(1);
  });
});

describe("single flight", () => {
  it("runs one scan at a time: a second call joins the first instead of querying again", async () => {
    await configure({ bluesky: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      return jsonResponse({ posts: [] });
    });
    const deps = { fetch: fetcher as unknown as typeof fetch, sleep, now, runAi: noAi };

    const first = runListeningScan(deps);
    const second = runListeningScan(deps);
    const third = runListeningScan(deps);
    release();
    const [a, b, c] = await Promise.all([first, second, third]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(a.joined).toBe(false);
    expect(b.joined).toBe(true);
    expect(c.joined).toBe(true);
    expect(b.report).toEqual(a.report);

    await runListeningScan(deps);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("lets the next scan start after one fails", async () => {
    await mkdir(path.dirname(dataPath("listening.json")), { recursive: true });
    await writeFile(dataPath("listening.json"), "{broken", "utf8");
    const deps = { fetch: vi.fn(async () => jsonResponse({ posts: [] })) as unknown as typeof fetch, sleep, now, runAi: noAi };

    await expect(runListeningScan(deps)).rejects.toThrow(/could not be read/);

    await rm(dataPath("listening.json"));
    await expect(runListeningScan(deps)).resolves.toMatchObject({ joined: false });
  });
});

describe("the two hour schedule", () => {
  const AT = NOW.getTime();

  it("is due when it has never run, or two hours have passed since it did", () => {
    expect(SCAN_INTERVAL_MS).toBe(2 * 60 * 60 * 1000);
    expect(isScanDue({ autoScan: true, lastScanAt: undefined, now: AT })).toBe(true);
    expect(isScanDue({ autoScan: true, lastScanAt: new Date(AT - SCAN_INTERVAL_MS).toISOString(), now: AT })).toBe(true);
    expect(isScanDue({ autoScan: true, lastScanAt: new Date(AT - SCAN_INTERVAL_MS + 60_000).toISOString(), now: AT })).toBe(false);
    expect(isScanDue({ autoScan: true, lastScanAt: "not a date", now: AT })).toBe(true);
  });

  it("is never due while automatic scanning is switched off", () => {
    expect(isScanDue({ autoScan: false, lastScanAt: undefined, now: AT })).toBe(false);
  });

  it("scans when due and leaves a scan that ran an hour ago alone, even after a restart", async () => {
    await configure({ bluesky: true });
    const fetcher = vi.fn(async () => jsonResponse({ posts: [] }));
    const deps = { fetch: fetcher as unknown as typeof fetch, sleep, now, runAi: noAi };

    expect(await scheduledScanOnce(deps)).not.toBeNull();
    const calls = fetcher.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    const later = { ...deps, now: () => new Date(AT + 60 * 60 * 1000) };
    expect(await scheduledScanOnce(later)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(calls);

    const muchLater = { ...deps, now: () => new Date(AT + 2 * 60 * 60 * 1000) };
    expect(await scheduledScanOnce(muchLater)).not.toBeNull();
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
  });

  it("does not scan when automatic scanning is off", async () => {
    await configure({ bluesky: true });
    await updateListeningConfig((config) => ({ ...config, autoScan: false }));
    const fetcher = vi.fn(async () => jsonResponse({ posts: [] }));

    expect(await scheduledScanOnce({ fetch: fetcher as unknown as typeof fetch, sleep, now, runAi: noAi })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect((await readListeningConfig()).autoScan).toBe(false);
  });

  it("records a scan's time even when the source failed, so a refusing source is asked every two hours and not every ten minutes", async () => {
    await configure({ bluesky: true });
    const fetcher = vi.fn(async () => jsonResponse({}, 403));
    const deps = { fetch: fetcher as unknown as typeof fetch, sleep, now, runAi: noAi };

    await scheduledScanOnce(deps);
    const calls = fetcher.mock.calls.length;
    expect((await readListeningStore()).lastScan?.at).toBe(NOW.toISOString());

    expect(await scheduledScanOnce({ ...deps, now: () => new Date(AT + 10 * 60 * 1000) })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});

describe("lead alerts", () => {
  function result(overrides: Partial<ListeningResult> & { id: string }): ListeningResult {
    return {
      source: "reddit",
      title: overrides.id,
      url: `https://www.reddit.com/${overrides.id}`,
      author: "",
      createdAt: "2026-10-12T10:00:00.000Z",
      excerpt: "",
      matchedTerms: [],
      status: "new",
      note: "",
      foundAt: "2026-10-12T12:00:00.000Z",
      category: "lead",
      sentiment: 0,
      score: 90,
      reason: "",
      classifiedBy: "ai",
      alsoOn: [],
      ...overrides
    };
  }

  it("counts only new leads at or above the high-score line", () => {
    expect(isHighLead(result({ id: "a" }))).toBe(true);
    expect(isHighLead(result({ id: "b", score: HIGH_LEAD_SCORE - 1 }))).toBe(false);
    expect(isHighLead(result({ id: "c", category: "mention" }))).toBe(false);
    expect(isHighLead(result({ id: "d", status: "seen" }))).toBe(false);
    expect(isHighLead(result({ id: "e", status: "sent-to-outreach" }))).toBe(false);
    expect(isHighLead(result({ id: "f", status: "dismissed" }))).toBe(false);
  });

  it("summarises them best first for the sidebar badge and the toast", () => {
    const summary = leadSummary([result({ id: "low", score: 72 }), result({ id: "top", score: 99 }), result({ id: "seen", status: "seen" }), result({ id: "noise", category: "noise" })], 5);
    expect(summary.newLeads).toBe(2);
    expect(summary.leads.map((lead) => lead.id)).toEqual(["top", "low"]);
    expect(summary.leads[0]).toMatchObject({ title: "top", source: "reddit", score: 99, url: "https://www.reddit.com/top" });
  });

  it("limits the listed leads but not the count", () => {
    const many = Array.from({ length: 30 }, (_, i) => result({ id: `lead-${i}`, score: 70 + (i % 30) }));
    const summary = leadSummary(many, 20);
    expect(summary.newLeads).toBe(30);
    expect(summary.leads).toHaveLength(20);
  });

  it("writes the status change Nic makes back to the store", async () => {
    await updateListeningStore((store) => ({ ...store, results: [result({ id: "x" })] }));
    await updateListeningStore((store) => ({ ...store, results: store.results.map((entry) => ({ ...entry, status: "seen" as const })) }));
    expect(leadSummary((await readListeningStore()).results).newLeads).toBe(0);
  });
});
