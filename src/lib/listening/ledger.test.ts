import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateListeningConfig } from "@/lib/listening/config";
import { listeningUnitsToday } from "@/lib/listening/ledger";
import { runListeningScan } from "@/lib/listening/run";
import { clearScanBackoff, scheduleEnabled, scheduledScanOnce, startListeningSchedule, stopListeningSchedule, SCAN_INTERVAL_MS } from "@/lib/listening/schedule";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { dataPath } from "@/lib/paths";

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

function deps(fetcher: ReturnType<typeof youtubeFetch>, extra: { offset?: number; budget?: number } = {}) {
  return {
    fetch: fetcher as unknown as typeof fetch,
    sleep,
    now: at(extra.offset ?? 0),
    runAi: noAi,
    youtubeAuth: async () => ({ key: "KEY" }),
    youtubeDailyUnits: extra.budget ?? 400
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
  await configureYoutubeOnly();
});

afterEach(() => {
  crash.armed = false;
  stopListeningSchedule();
});

describe("the YouTube quota ledger", () => {
  it("is debited in the store before the search leaves the machine", async () => {
    let unitsWhenSent = -1;
    const fetcher = youtubeFetch(async () => {
      unitsWhenSent = (await readListeningStore()).youtube.units;
    });

    await runListeningScan(deps(fetcher));

    expect(unitsWhenSent).toBe(100);
    expect((await readListeningStore()).youtube).toMatchObject({ day: "2026-10-12", units: 101 });
  });

  it("changes the stored numbers by what this scan spent, not back to what it read when it started", async () => {
    const fetcher = youtubeFetch(async () => {
      await updateListeningStore((store) => ({ ...store, youtube: { ...store.youtube, units: store.youtube.units + 50, cursor: store.youtube.cursor + 10 } }));
    });

    await runListeningScan(deps(fetcher));

    expect((await readListeningStore()).youtube).toEqual({ day: "2026-10-12", units: 50 + 100 + 1, cursor: 10 + 1 });
  });

  it("keeps counting across scans and a crash after the fetch, reloading the ledger from disk each time", async () => {
    const first = youtubeFetch();
    await runListeningScan(deps(first));
    expect((await readListeningStore()).youtube.units).toBe(101);

    crash.armed = true;
    const second = youtubeFetch();
    await expect(runListeningScan(deps(second))).rejects.toThrow(/process died/);
    expect(searchesIn(second)).toBe(1);
    const afterCrash = await readListeningStore();
    expect(afterCrash.youtube.units).toBe(202);
    expect(afterCrash.lastScan?.error).toMatch(/process died/);
    crash.armed = false;

    const third = youtubeFetch();
    await runListeningScan(deps(third));
    expect(searchesIn(third)).toBe(1);
    expect((await readListeningStore()).youtube.units).toBe(303);

    const fourth = youtubeFetch();
    await runListeningScan(deps(fourth));
    expect(searchesIn(fourth)).toBe(0);
    expect((await readListeningStore()).youtube.units).toBe(303);
  });
});

describe("what Listening has spent today", () => {
  it("reads today's units from the ledger, and nothing for another day or a file it cannot read", async () => {
    await updateListeningStore((store) => ({ ...store, youtube: { day: "2026-10-12", units: 250, cursor: 0 } }));
    expect(await listeningUnitsToday(NOW)).toBe(250);
    expect(await listeningUnitsToday(new Date("2026-10-14T06:00:00.000Z"))).toBe(0);

    await writeFile(dataPath("listening.json"), "{broken", "utf8");
    expect(await listeningUnitsToday(NOW)).toBe(0);
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
