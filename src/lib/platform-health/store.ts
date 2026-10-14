import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import {
  RECONNECT_URL,
  authStateKey,
  type AuthTarget,
  type HealthPlatformId,
  type PlatformAuthState
} from "@/lib/platform-health/types";

export const AUTH_PROBE_MINUTES = 30;

export type AuthStates = Record<string, PlatformAuthState>;

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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as AuthStates).filter(([, state]) => typeof state?.accountId === "string")
    );
  } catch {
    return {};
  }
}

async function writeAuthStates(states: AuthStates): Promise<void> {
  await atomicWriteJson(statePath(), states);
}

export function recordAuthFailure(
  target: AuthTarget,
  reason: string,
  options: { now?: Date; fingerprint: string | null }
): Promise<PlatformAuthState> {
  return serialized(async () => {
    const now = options.now ?? new Date();
    const states = await readAuthStates();
    const key = authStateKey(target.platform, target.accountId);
    const previous = states[key];
    const sameOutage = previous !== undefined && previous.fingerprint === options.fingerprint;
    const next: PlatformAuthState = {
      platform: target.platform,
      accountId: target.accountId,
      accountLabel: target.accountLabel ?? null,
      since: sameOutage ? previous.since : now.toISOString(),
      lastFailureAt: now.toISOString(),
      reason,
      fixUrl: RECONNECT_URL,
      fingerprint: options.fingerprint,
      nextProbeAt: new Date(now.getTime() + AUTH_PROBE_MINUTES * 60_000).toISOString(),
      failures: sameOutage ? previous.failures + 1 : 1
    };
    await writeAuthStates({ ...states, [key]: next });
    return next;
  });
}

export function clearAuthState(platform: HealthPlatformId, accountId: string): Promise<boolean> {
  return serialized(async () => {
    const states = await readAuthStates();
    const key = authStateKey(platform, accountId);
    if (!states[key]) return false;
    const rest = { ...states };
    delete rest[key];
    await writeAuthStates(rest);
    return true;
  });
}

export async function accountAuthBlocked(
  platform: HealthPlatformId,
  accountId: string,
  fingerprint: string | null,
  now: Date
): Promise<boolean> {
  const state = (await readAuthStates())[authStateKey(platform, accountId)];
  if (!state) return false;
  if (state.fingerprint !== fingerprint) {
    await clearAuthState(platform, accountId);
    return false;
  }
  return Date.parse(state.nextProbeAt) > now.getTime();
}

export async function activeAuthStates(
  currentFingerprint: (platform: HealthPlatformId, accountId: string) => Promise<string | null | undefined>
): Promise<PlatformAuthState[]> {
  const states = await readAuthStates();
  const active: PlatformAuthState[] = [];
  for (const state of Object.values(states)) {
    const current = await currentFingerprint(state.platform, state.accountId);
    if (current === undefined || current !== state.fingerprint) {
      await clearAuthState(state.platform, state.accountId);
      continue;
    }
    active.push(state);
  }
  return active;
}
