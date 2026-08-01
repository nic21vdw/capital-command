import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The autopilot's heartbeat.
 *
 * A queue full of pending posts looks identical whether the scheduled task is
 * ticking every five minutes or was switched off three days ago. Stamping each
 * tick is what lets the dashboard answer the only question that matters at a
 * glance — "is this thing actually running?" — instead of implying it is.
 */

const FILE_PATH = path.join(process.cwd(), "data", "threads-state.json");

export type ThreadsState = {
  /** When a tick last ran, whether or not it had anything to do. */
  lastTickAt?: string;
  /** When a batch was last planned, and how many posts it added. */
  lastPlanAt?: string;
  lastPlanCreated?: number;
  /** When a tick last published anything. */
  lastPostAt?: string;
  /** The last day written in advance, so the evening's ticks plan it once. */
  plannedAheadFor?: string;
  /** When a day was last re-laid after falling behind — gates the cooldown. */
  lastCatchUpAt?: string;
};

export async function readThreadsState(): Promise<ThreadsState> {
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ThreadsState) : {};
  } catch {
    return {};
  }
}

export async function recordThreadsState(patch: ThreadsState): Promise<void> {
  const next = { ...(await readThreadsState()), ...patch };
  await mkdir(path.dirname(FILE_PATH), { recursive: true });
  const tmpPath = `${FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
  await rename(tmpPath, FILE_PATH);
}

/**
 * How the dashboard should read the heartbeat. The scheduled task ticks every
 * five minutes, so a gap of more than three intervals means something is wrong
 * — the task is disabled, the machine slept, or the app can't start.
 */
export function tickHealth(
  state: ThreadsState,
  now: Date = new Date()
): { healthy: boolean; minutesSince: number | null } {
  if (!state.lastTickAt) return { healthy: false, minutesSince: null };
  const minutesSince = (now.getTime() - new Date(state.lastTickAt).getTime()) / 60_000;
  return { healthy: minutesSince <= 15, minutesSince };
}
