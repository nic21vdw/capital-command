import { readListeningConfig } from "@/lib/listening/config";
import { SCAN_INTERVAL_MS, isScanDue } from "@/lib/listening/model";
import { runListeningScan, type RunDeps, type ScanOutcome } from "@/lib/listening/run";
import { readListeningStore } from "@/lib/listening/store";

export { SCAN_INTERVAL_MS, isScanDue };

const CHECK_EVERY_MS = 10 * 60 * 1000;
const FIRST_CHECK_MS = 2 * 60 * 1000;

type Env = Record<string, string | undefined>;
type ScheduleHolder = typeof globalThis & {
  __listeningSchedule?: { interval: NodeJS.Timeout; first: NodeJS.Timeout };
  __listeningFailedAt?: number;
};
const holder = globalThis as ScheduleHolder;

export function scheduleEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV === "production" || env.LISTENING_SCHEDULE === "1";
}

export function clearScanBackoff() {
  holder.__listeningFailedAt = undefined;
}

export async function scheduledScanOnce(deps: RunDeps = {}): Promise<ScanOutcome | null> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const failedAt = holder.__listeningFailedAt;
  if (failedAt !== undefined && now - failedAt < SCAN_INTERVAL_MS) return null;
  try {
    const [config, store] = await Promise.all([readListeningConfig(), readListeningStore()]);
    if (!isScanDue({ autoScan: config.autoScan, lastScanAt: store.lastScan?.at, now })) return null;
    const outcome = await runListeningScan(deps);
    clearScanBackoff();
    return outcome;
  } catch (error) {
    holder.__listeningFailedAt = now;
    throw error;
  }
}

export function startListeningSchedule(env: Env = process.env): boolean {
  if (!scheduleEnabled(env) || holder.__listeningSchedule) return false;
  const tick = () => {
    void scheduledScanOnce().catch((error) => console.warn("[listening] scheduled scan failed:", error instanceof Error ? error.message : error));
  };
  const interval = setInterval(tick, CHECK_EVERY_MS);
  const first = setTimeout(tick, FIRST_CHECK_MS);
  interval.unref?.();
  first.unref?.();
  holder.__listeningSchedule = { interval, first };
  return true;
}

export function stopListeningSchedule() {
  if (!holder.__listeningSchedule) return;
  clearInterval(holder.__listeningSchedule.interval);
  clearTimeout(holder.__listeningSchedule.first);
  holder.__listeningSchedule = undefined;
}
