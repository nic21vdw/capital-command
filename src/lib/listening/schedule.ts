import { readListeningConfig } from "@/lib/listening/config";
import { SCAN_INTERVAL_MS, isScanDue } from "@/lib/listening/model";
import { runListeningScan, type RunDeps, type ScanOutcome } from "@/lib/listening/run";
import { readListeningStore } from "@/lib/listening/store";

export { SCAN_INTERVAL_MS, isScanDue };

const CHECK_EVERY_MS = 10 * 60 * 1000;
const FIRST_CHECK_MS = 2 * 60 * 1000;

export async function scheduledScanOnce(deps: RunDeps = {}): Promise<ScanOutcome | null> {
  const [config, store] = await Promise.all([readListeningConfig(), readListeningStore()]);
  const now = (deps.now ?? (() => new Date()))().getTime();
  if (!isScanDue({ autoScan: config.autoScan, lastScanAt: store.lastScan?.at, now })) return null;
  return runListeningScan(deps);
}

type ScheduleHolder = typeof globalThis & { __listeningSchedule?: NodeJS.Timeout };
const holder = globalThis as ScheduleHolder;

export function startListeningSchedule() {
  if (holder.__listeningSchedule) return;
  const tick = () => {
    void scheduledScanOnce().catch((error) => console.warn("[listening] scheduled scan failed:", error instanceof Error ? error.message : error));
  };
  holder.__listeningSchedule = setInterval(tick, CHECK_EVERY_MS);
  holder.__listeningSchedule.unref?.();
  setTimeout(tick, FIRST_CHECK_MS).unref?.();
}
