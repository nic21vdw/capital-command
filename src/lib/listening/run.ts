import { classifyHits, type ClassifyDeps } from "@/lib/listening/classify";
import { readListeningConfig } from "@/lib/listening/config";
import { isHighLead } from "@/lib/listening/leads";
import { storeLedger } from "@/lib/listening/ledger";
import { normalizeResultUrl, splitNewHits, type ScanReport } from "@/lib/listening/model";
import { applyScan, collectScan, type CollectedScan, type ScanDeps } from "@/lib/listening/scan";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";

export interface RunDeps extends ScanDeps {
  runAi?: ClassifyDeps["runAi"];
}

export interface ScanOutcome {
  report: ScanReport;
  classified: { ai: number; heuristic: number };
  newLeads: number;
  joined: boolean;
}

type FlightHolder = typeof globalThis & { __listeningScan?: Promise<ScanOutcome> };
const holder = globalThis as FlightHolder;

async function scanOnce(deps: RunDeps): Promise<ScanOutcome> {
  const config = await readListeningConfig();
  const before = await readListeningStore();
  const collected = await collectScan(
    { groups: config.groups, sources: config.sources, redditCursor: before.redditCursor },
    { ...deps, youtubeLedger: deps.youtubeLedger ?? storeLedger() }
  );

  const fresh = splitNewHits(before.results, collected.sources.flatMap((source) => source.hits));
  const classified = await classifyHits(fresh, config.groups, { runAi: deps.runAi, now: deps.now });
  const byUrl = new Map(classified.hits.map((hit) => [normalizeResultUrl(hit.url), hit]));
  const enriched: CollectedScan = {
    ...collected,
    sources: collected.sources.map(({ hits, report }) => ({ hits: hits.map((hit) => byUrl.get(normalizeResultUrl(hit.url)) ?? hit), report }))
  };

  const counts = { ai: classified.ai, heuristic: classified.heuristic };
  let report: ScanReport | undefined;
  let newLeads = 0;
  await updateListeningStore((current) => {
    const known = new Set(current.results.map((result) => result.id));
    const applied = applyScan(current, enriched, counts);
    report = applied.report;
    newLeads = applied.store.results.filter((result) => !known.has(result.id) && isHighLead(result)).length;
    return applied.store;
  });
  if (!report) throw new Error("The scan produced no report.");
  return { report, classified: counts, newLeads, joined: false };
}

async function recordScanFailure(error: unknown, at: Date): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await updateListeningStore((current) => ({ ...current, lastScan: { at: at.toISOString(), sources: [], error: message.slice(0, 500) } }));
}

export function runListeningScan(deps: RunDeps = {}): Promise<ScanOutcome> {
  const running = holder.__listeningScan;
  if (running) return running.then((outcome) => ({ ...outcome, joined: true }));
  const flight: Promise<ScanOutcome> = scanOnce(deps)
    .catch(async (error: unknown) => {
      await recordScanFailure(error, (deps.now ?? (() => new Date()))()).catch(() => undefined);
      throw error;
    })
    .finally(() => {
      if (holder.__listeningScan === flight) holder.__listeningScan = undefined;
    });
  holder.__listeningScan = flight;
  return flight;
}
