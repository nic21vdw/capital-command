import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { RECONNECT_URL, type HealthPlatformId, type PlatformAuthState } from "@/lib/platform-health/types";

export const AUTH_PROBE_MINUTES = 30;

export type AuthStates = Partial<Record<HealthPlatformId, PlatformAuthState>>;

let pending: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);
  return next;
}

function statePath(): string {
  return dataPath("platform-auth.json");
}

export async function readAuthStates(): Promise<AuthStates> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AuthStates) : {};
  } catch {
    return {};
  }
}

async function writeAuthStates(states: AuthStates): Promise<void> {
  const target = statePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(states, null, 2), "utf8");
  await rename(temp, target);
}

export function recordAuthFailure(
  platform: HealthPlatformId,
  reason: string,
  options: { now?: Date; fingerprint: string | null }
): Promise<PlatformAuthState> {
  return serialized(async () => {
    const now = options.now ?? new Date();
    const states = await readAuthStates();
    const previous = states[platform];
    const sameOutage = previous !== undefined && previous.fingerprint === options.fingerprint;
    const next: PlatformAuthState = {
      platform,
      since: sameOutage ? previous.since : now.toISOString(),
      lastFailureAt: now.toISOString(),
      reason,
      fixUrl: RECONNECT_URL,
      fingerprint: options.fingerprint,
      nextProbeAt: new Date(now.getTime() + AUTH_PROBE_MINUTES * 60_000).toISOString(),
      failures: sameOutage ? previous.failures + 1 : 1
    };
    await writeAuthStates({ ...states, [platform]: next });
    return next;
  });
}

export function clearAuthState(platform: HealthPlatformId): Promise<boolean> {
  return serialized(async () => {
    const states = await readAuthStates();
    if (!states[platform]) return false;
    const rest = { ...states };
    delete rest[platform];
    await writeAuthStates(rest);
    return true;
  });
}

export async function platformAuthBlocked(
  platform: HealthPlatformId,
  fingerprint: string | null,
  now: Date
): Promise<boolean> {
  const state = (await readAuthStates())[platform];
  if (!state) return false;
  if (state.fingerprint !== fingerprint) {
    await clearAuthState(platform);
    return false;
  }
  return Date.parse(state.nextProbeAt) > now.getTime();
}

export async function activeAuthStates(
  fingerprints: Partial<Record<HealthPlatformId, string | null>>
): Promise<PlatformAuthState[]> {
  const states = await readAuthStates();
  const active: PlatformAuthState[] = [];
  for (const state of Object.values(states)) {
    if (!state) continue;
    if (state.platform in fingerprints && fingerprints[state.platform] !== state.fingerprint) {
      await clearAuthState(state.platform);
      continue;
    }
    active.push(state);
  }
  return active;
}
