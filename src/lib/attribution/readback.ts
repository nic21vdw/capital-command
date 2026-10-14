import { isPostCode } from "@/lib/attribution/code";

export const ATTRIBUTION_SLUGS = ["yt", "ig", "tt", "fb", "th", "x"] as const;
export type AttributionSlug = (typeof ATTRIBUTION_SLUGS)[number];

export type AttributionRow = {
  platform: AttributionSlug;
  code: string | null;
  visits: number;
  buys: number;
  orders: number;
  revenue: Record<string, number>;
};

export type AttributionSummary = { from: string; to: string; rows: AttributionRow[] };

export type ReadbackConfig = { url: string; token: string };

export type UnavailableReason = "not_enabled" | "unauthorised" | "http" | "network" | "invalid";

export type ReadbackResult =
  | { status: "disabled" }
  | { status: "ok"; summary: AttributionSummary }
  | { status: "unavailable"; reason: UnavailableReason; message: string };

type Env = Record<string, string | undefined>;

type DayRange = { from: string; to: string };

type ReadbackOptions = {
  env?: Env;
  fetcher?: typeof fetch;
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function readbackConfig(env: Env = process.env): ReadbackConfig | null {
  const rawUrl = env.COLATERAL_ATTRIBUTION_URL?.trim();
  const token = env.COLATERAL_ATTRIBUTION_TOKEN?.trim();
  if (!rawUrl || !token) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const loopback = env.COLATERAL_ATTRIBUTION_ALLOW_LOOPBACK === "1" && parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname);
  const secure = parsed.protocol === "https:" || loopback;
  return secure ? { url: parsed.toString(), token } : null;
}

export function lastDays(days: number, now: Date = new Date()): DayRange {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(Date.parse(to) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function revenueOf(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object") return out;
  for (const [currency, cents] of Object.entries(value)) {
    const amount = count(cents);
    if (CURRENCY.test(currency) && amount !== null) out[currency.toUpperCase()] = amount;
  }
  return out;
}

function rowOf(value: unknown): AttributionRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const platform = ATTRIBUTION_SLUGS.find((slug) => slug === row.platform);
  const code = row.code === null || row.code === undefined ? null : row.code;
  const visits = count(row.visits);
  const buys = count(row.buys);
  const orders = count(row.orders);
  if (!platform || visits === null || buys === null || orders === null) return null;
  if (code !== null && !isPostCode(code)) return null;
  return { platform, code, visits, buys, orders, revenue: revenueOf(row.revenue) };
}

function unavailable(reason: UnavailableReason, message: string): ReadbackResult {
  return { status: "unavailable", reason, message };
}

export async function fetchAttributionSummary(range: DayRange, options: ReadbackOptions = {}): Promise<ReadbackResult> {
  const config = readbackConfig(options.env ?? process.env);
  if (!config) return { status: "disabled" };
  if (!DAY_KEY.test(range.from) || !DAY_KEY.test(range.to)) return unavailable("invalid", "The date window was not valid.");

  const url = new URL(config.url);
  url.searchParams.set("from", range.from);
  url.searchParams.set("to", range.to);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    return unavailable("network", "Could not reach CoLateral.");
  }

  if (response.status === 503) return unavailable("not_enabled", "CoLateral has not switched attribution on yet.");
  if (response.status === 401 || response.status === 403) return unavailable("unauthorised", "CoLateral rejected the attribution token.");
  if (!response.ok) return unavailable("http", `CoLateral answered ${response.status}.`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unavailable("invalid", "CoLateral sent something that was not a summary.");
  }
  const rows = body && typeof body === "object" ? (body as { rows?: unknown }).rows : undefined;
  if (!Array.isArray(rows)) return unavailable("invalid", "CoLateral sent something that was not a summary.");

  return {
    status: "ok",
    summary: { from: range.from, to: range.to, rows: rows.map(rowOf).filter((row): row is AttributionRow => row !== null) }
  };
}
