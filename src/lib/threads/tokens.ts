import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchJson } from "@/lib/publisher/http";
import { dataPath } from "@/lib/paths";
import type { ThreadsAccount, ThreadsConfig } from "@/lib/threads/config";

/**
 * Keeps the Threads tokens alive.
 *
 * A long-lived Threads token dies 60 days after it was minted unless it is
 * refreshed, and nothing used to refresh it. The autopilot then posted for two
 * months and went quiet: every post failed on an expired token, and the feed
 * just stopped with no one looking at the log.
 *
 * Meta's `refresh_access_token` hands back a fresh 60-day token for any token
 * that is at least a day old and not yet expired. The tick asks for one every
 * `THREADS_TOKEN_REFRESH_DAYS` (7), so a token in use never gets close to its
 * expiry. The refreshed token is kept in `data/threads-tokens.json`, keyed to a
 * hash of the token in `.env` it came from: paste a new token into `.env` and
 * that one wins at once, with no stale refresh standing in its way.
 *
 * An already expired token cannot be refreshed. That one needs a new token
 * pasted into `.env` (see the Setup section of README.md).
 */

export type StoredToken = {
  /** sha256 of the `.env` token this one descends from. */
  source: string;
  token: string;
  refreshedAt: string;
  expiresAt: string | null;
  /**
   * The last failed attempt, so a refusal is retried hours later, not every
   * tick. A token under a day old is refused by Meta, and this is what spaces
   * the attempts out until it is old enough.
   */
  lastErrorAt?: string;
  lastError?: string;
};

type TokenFile = Record<string, StoredToken>;

const DAY_MS = 86_400_000;
const RETRY_AFTER_ERROR_MS = 6 * 60 * 60 * 1000;

function tokenFile(): string {
  return dataPath("threads-tokens.json");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Synchronous on purpose: `threadsConfig()` is synchronous and called all over
 * the app, and this file is a few hundred bytes.
 */
export function readStoredTokens(): TokenFile {
  try {
    const parsed = JSON.parse(readFileSync(tokenFile(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as TokenFile) : {};
  } catch {
    return {};
  }
}

/** The token to use for an account: the refreshed one if it still matches `.env`. */
export function effectiveToken(accountId: string, envToken: string, stored: TokenFile = readStoredTokens()): string {
  const entry = stored[accountId];
  if (!entry || entry.source !== hashToken(envToken) || !entry.token) return envToken;
  if (entry.expiresAt && Date.parse(entry.expiresAt) <= Date.now()) return envToken;
  return entry.token;
}

async function writeStoredTokens(file: TokenFile): Promise<void> {
  const target = tokenFile();
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(file, null, 2), "utf8");
  await rename(temp, target);
}

function refreshDays(): number {
  const raw = Number(process.env.THREADS_TOKEN_REFRESH_DAYS);
  return Number.isFinite(raw) && raw >= 1 ? raw : 7;
}

export type TokenRefreshOutcome = { accountId: string; outcome: "refreshed" | "fresh" | "failed"; detail: string };

/**
 * Refreshes every account whose token is due. Never throws: a failed refresh
 * leaves the current token in place, and posting carries on with it.
 *
 * `envTokens` maps account id to the token in `.env`, because the accounts in
 * `config` already carry the effective (possibly refreshed) token.
 */
export async function refreshThreadsTokens(
  config: ThreadsConfig,
  envTokens: Record<string, string>,
  now: Date = new Date()
): Promise<TokenRefreshOutcome[]> {
  const stored = readStoredTokens();
  const outcomes: TokenRefreshOutcome[] = [];
  let changed = false;

  for (const account of config.accounts) {
    const envToken = envTokens[account.id];
    if (!envToken) continue;
    const source = hashToken(envToken);
    const entry = stored[account.id]?.source === source ? stored[account.id] : undefined;

    const lastRefresh = entry ? Date.parse(entry.refreshedAt) : NaN;
    if (Number.isFinite(lastRefresh) && now.getTime() - lastRefresh < refreshDays() * DAY_MS) {
      outcomes.push({ accountId: account.id, outcome: "fresh", detail: "Token refreshed recently." });
      continue;
    }
    if (entry?.lastErrorAt && now.getTime() - Date.parse(entry.lastErrorAt) < RETRY_AFTER_ERROR_MS) {
      outcomes.push({ accountId: account.id, outcome: "failed", detail: entry.lastError ?? "Token refresh failed recently." });
      continue;
    }

    try {
      const fresh = await requestRefresh(account, config);
      stored[account.id] = {
        source,
        token: fresh.token,
        refreshedAt: now.toISOString(),
        expiresAt: fresh.expiresInSeconds ? new Date(now.getTime() + fresh.expiresInSeconds * 1000).toISOString() : null
      };
      outcomes.push({ accountId: account.id, outcome: "refreshed", detail: "Token refreshed for another 60 days." });
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), [envToken, account.accessToken]);
      stored[account.id] = {
        ...(entry ?? { source, token: "", refreshedAt: "", expiresAt: null }),
        lastErrorAt: now.toISOString(),
        lastError: message.slice(0, 400)
      };
      outcomes.push({ accountId: account.id, outcome: "failed", detail: message });
    }
    changed = true;
  }

  if (changed) await writeStoredTokens(stored).catch(() => undefined);
  return outcomes;
}

type RefreshResponse = { access_token?: string; expires_in?: number };

function refusedForOtherThanExpiry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\(HTTP (?:400|401)\)/.test(message) && !/expired|revoked/i.test(message);
}

async function requestRefresh(
  account: ThreadsAccount,
  config: ThreadsConfig
): Promise<{ token: string; expiresInSeconds: number | null }> {
  const base = `${config.apiBase}/refresh_access_token?grant_type=th_refresh_token`;
  const label = `Threads token refresh (${account.label})`;
  let data: RefreshResponse;
  try {
    data = await fetchJson<RefreshResponse>(base, {
      label,
      method: "GET",
      headers: { Authorization: `Bearer ${account.accessToken}` }
    });
  } catch (error) {
    if (!refusedForOtherThanExpiry(error)) throw error;
    data = await fetchJson<RefreshResponse>(`${base}&access_token=${encodeURIComponent(account.accessToken)}`, {
      label,
      method: "GET"
    });
  }
  if (!data.access_token) throw new Error("Threads returned no token from the refresh.");
  return { token: data.access_token, expiresInSeconds: Number(data.expires_in) || null };
}

function redact(message: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((text, secret) => {
    const forms = new Set([secret, encodeURIComponent(secret), new URLSearchParams({ t: secret }).toString().slice(2)]);
    return [...forms].reduce((clean, form) => clean.split(form).join("[token]"), text);
  }, message);
}
