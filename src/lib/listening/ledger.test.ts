import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateListeningConfig } from "@/lib/listening/config";
import { storeLedger } from "@/lib/listening/ledger";
import { runListeningScan } from "@/lib/listening/run";
import { clearScanBackoff, scheduleEnabled, scheduledScanOnce, startListeningSchedule, stopListeningSchedule, SCAN_INTERVAL_MS } from "@/lib/listening/schedule";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { dataPath } from "@/lib/paths";
import { createQuotaLedger, ledgerConfig, quotaLedgerFile, type LedgerConfig } from "@/lib/youtube/quotaLedger";

const crash = vi.hoisted(() => ({ armed: false }));

vi.mock("@/lib/listening/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/listening/store")>();
  return {
    ...actual,
    updateListeningStore: (mutate: Parameters<typeof actual.updateListeningStore>[0]) =>
      actual.updateListeningStore(async (current) => {
        const next = await mutate(current);
        if (crash.armed && next.lastScan && !next.lastScan.error && next.lastScan !== current.lastScan) {
          throw new Error("the process died before the results were saved");
        }
        return next;
      })
  };
});

const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8")) as unknown;
const NOW = new Date("2026-10-13T06:00:00.000Z");
const at = (offsetMs = 0) => () => new Date(NOW.getTime() + offsetMs);
const sleep = () => Promise.resolve();
const noAi = async () => null;
const TEN_MINUTES = 10 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const isSearch = (url: string) => url.includes("/youtube/v3/search");

function youtubeFetch(onSearch?: () => Promise<void>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (isSearch(url)) {
      await onSearch?.();
      return jsonResponse(fixture("youtube-search.json"));
    }
    return jsonResponse(fixture("youtube-comments.json"));
  });
}

const searchesIn = (fetcher: ReturnType<typeof youtubeFetch>) => fetcher.mock.calls.filter(([input]) => isSearch(String(input))).length;

const BIG_LISTENING_CAP: LedgerConfig = { ...ledgerConfig({}), nonUploadUnits: 400, purposeCaps: { inbox: 200, listening: 400 } };

function quotaAt(offsetMs = 0) {
  return createQuotaLedger({ now: at(offsetMs), config: () => BIG_LISTENING_CAP });
}

function deps(fetcher: ReturnType<typeof youtubeFetch>, extra: { offset?: number; budget?: number } = {}) {
  return {
    fetch: fetcher as unknown as typeof fetch,
    sleep,
    now: at(extra.offset ?? 0),
    runAi: noAi,
    youtubeAuth: async () => ({ key: "KEY" }),
    youtubeDailyUnits: extra.budget ?? 400,
    youtubeLedger: storeLedger(quotaAt(extra.offset ?? 0))
  };
}

async function configureYoutubeOnly() {
  await updateListeningConfig((config) => ({
    ...config,
    groups: [{ id: "g", name: "G", intent: "competitor", canLead: true, terms: ["ETABS", "SAP2000", "RISA", "Tekla", "Revit"] }],
    sources: { hn: false, reddit: false, youtube: true, bluesky: false, x: false }
  }));
}

beforeEach(async () => {
  crash.armed = false;
  clearScanBackoff();
  await rm(dataPath("listening.json"), { force: true });
  await rm(dataPath("listening"), { recursive: true, force: true });
  await rm(quotaLedgerFile(), { force: true });
  await configureYoutubeOnly();
});

afterEach(() => {
  crash.armed = false;
  stopListeningSchedule();
});

const listeningUnits = async (quota = quotaAt()) => (await quota.snapshot()).byPurpose.listening;

describe("the YouTube quota ledger", () => {
  it("is debited in the shared ledger before the search leaves the machine", async () => {
    let unitsWhenSent = -1;
    const fetcher = youtubeFetch(async () => {
      unitsWhenSent = (await listeningUnits()) ?? 0;
    });

    await runListeningScan(deps(fetcher));

    expect(unitsWhenSent).toBe(100);
    expect(await listeningUnits()).toBe(101);
  });

  it("no longer writes the old counter in the Listening store, which keeps only its rotation cursor moving", async () => {
    await runListeningScan(deps(youtubeFetch()));

    expect((await readListeningStore()).youtube).toEqual({ day: "", units: 0, cursor: 1 });
  });

  it("changes the stored numbers by what this scan spent, not back to what it read when it started", async () => {
    const quota = quotaAt();
    const fetcher = youtubeFetch(async () => {
      await quota.debit(50, "listening");
      await updateListeningStore((store) => ({ ...store, youtube: { ...store.youtube, cursor: store.youtube.cursor + 10 } }));
    });

    await runListeningScan(deps(fetcher));

    expect(await listeningUnits(quota)).toBe(50 + 100 + 1);
    expect((await readListeningStore()).youtube.cursor).toBe(10 + 1);
  });

  it("keeps counting across scans and a crash after the fetch, reloading the ledger from disk each time", async () => {
    const first = youtubeFetch();
    await runListeningScan(deps(first));
    expect(await listeningUnits()).toBe(101);

    crash.armed = true;
    const second = youtubeFetch();
    await expect(runListeningScan(deps(second))).rejects.toThrow(/process died/);
    expect(searchesIn(second)).toBe(1);
    const afterCrash = await readListeningStore();
    expect(await listeningUnits()).toBe(202);
    expect(afterCrash.lastScan?.error).toMatch(/process died/);
    crash.armed = false;

    const third = youtubeFetch();
    await runListeningScan(deps(third));
    expect(searchesIn(third)).toBe(1);
    expect(await listeningUnits()).toBe(303);

    const fourth = youtubeFetch();
    await runListeningScan(deps(fourth));
    expect(searchesIn(fourth)).toBe(0);
    expect(await listeningUnits()).toBe(303);
  });

  it("stops at its own 100-unit sub-cap when the shared ledger is the real one", async () => {
    const real = createQuotaLedger({ now: at() });
    const smallDeps = (fetcher: ReturnType<typeof youtubeFetch>) => ({ ...deps(fetcher), youtubeDailyUnits: 400, youtubeLedger: storeLedger(real) });

    const first = youtubeFetch();
    await runListeningScan(smallDeps(first));
    expect(searchesIn(first)).toBe(1);
    expect((await real.snapshot()).byPurpose.listening).toBe(100);

    const second = youtubeFetch();
    const outcome = await runListeningScan(smallDeps(second));
    expect(searchesIn(second)).toBe(0);
    expect(outcome.report.sources[0].note).toMatch(/quota saved for uploads/i);
  });

  it("shares the 300-unit allowance, so a spent allowance turns the search away", async () => {
    const real = createQuotaLedger({ now: at() });
    await real.debit(300, "outliers");
    const fetcher = youtubeFetch();

    await runListeningScan({ ...deps(fetcher), youtubeLedger: storeLedger(real) });

    expect(searchesIn(fetcher)).toBe(0);
  });
});

describe("a failed scan", () => {
  it("is recorded as the last scan, so the next attempt waits two hours and not ten minutes", async () => {
    crash.armed = true;
    const failing = youtubeFetch();
    await expect(scheduledScanOnce(deps(failing))).rejects.toThrow(/process died/);

    const recorded = (await readListeningStore()).lastScan;
    expect(recorded).toMatchObject({ at: NOW.toISOString(), sources: [] });
    expect(recorded?.error).toMatch(/process died/);
    crash.armed = false;
    clearScanBackoff();

    const soon = youtubeFetch();
    expect(await scheduledScanOnce(deps(soon, { offset: TEN_MINUTES }))).toBeNull();
    expect(soon).not.toHaveBeenCalled();

    const later = youtubeFetch();
    expect(await scheduledScanOnce(deps(later, { offset: SCAN_INTERVAL_MS }))).not.toBeNull();
    expect(later).toHaveBeenCalled();
  });

  it("backs off in memory when even the failure cannot be written down", async () => {
    await mkdir(path.dirname(dataPath("listening.json")), { recursive: true });
    await writeFile(dataPath("listening.json"), "{broken", "utf8");
    const fetcher = youtubeFetch();

    await expect(scheduledScanOnce(deps(fetcher))).rejects.toThrow(/could not be read/);
    expect(await scheduledScanOnce(deps(fetcher, { offset: TEN_MINUTES }))).toBeNull();
    await expect(scheduledScanOnce(deps(fetcher, { offset: SCAN_INTERVAL_MS }))).rejects.toThrow(/could not be read/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("when the schedule starts", () => {
  it("runs in production, or when LISTENING_SCHEDULE=1, and nowhere else", () => {
    expect(scheduleEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(scheduleEnabled({ NODE_ENV: "development", LISTENING_SCHEDULE: "1" })).toBe(true);
    expect(scheduleEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(scheduleEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(scheduleEnabled({})).toBe(false);
    expect(scheduleEnabled({ NODE_ENV: "development", LISTENING_SCHEDULE: "0" })).toBe(false);
  });

  it("registers no timer in a dev server, and one timer in production however often it is called", () => {
    vi.useFakeTimers();
    try {
      expect(startListeningSchedule({ NODE_ENV: "development" })).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(startListeningSchedule({ NODE_ENV: "production" })).toBe(true);
      const timers = vi.getTimerCount();
      expect(timers).toBeGreaterThan(0);
      expect(startListeningSchedule({ NODE_ENV: "production" })).toBe(false);
      expect(vi.getTimerCount()).toBe(timers);
    } finally {
      stopListeningSchedule();
      vi.useRealTimers();
    }
  });
});
