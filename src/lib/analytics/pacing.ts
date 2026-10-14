import { requestJson, type HttpDeps, type JsonRequest } from "@/lib/analytics/http";
import { PacedStop, type Stop } from "@/lib/analytics/outcome";

export const META_USAGE_STOP_PERCENT = 75;
export const DEFAULT_META_CALLS_PER_RUN = 150;

const HOUR_MS = 3_600_000;
const USAGE_KEYS = ["call_count", "total_time", "total_cputime"] as const;

export type MetaUsage = { percent: number; regainMinutes: number };

function readJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function percentOf(entry: unknown): number {
  if (typeof entry !== "object" || entry === null) return 0;
  const record = entry as Record<string, unknown>;
  return Math.max(0, ...USAGE_KEYS.map((key) => (typeof record[key] === "number" ? (record[key] as number) : 0)));
}

export function parseMetaUsage(headers: Headers): MetaUsage {
  let percent = 0;
  let regainMinutes = 0;

  const app = readJson(headers.get("x-app-usage"));
  if (app) percent = Math.max(percent, percentOf(app));

  const business = readJson(headers.get("x-business-use-case-usage"));
  if (business && typeof business === "object") {
    for (const entries of Object.values(business as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        percent = Math.max(percent, percentOf(entry));
        const regain = (entry as { estimated_time_to_regain_access?: unknown })?.estimated_time_to_regain_access;
        if (typeof regain === "number") regainMinutes = Math.max(regainMinutes, regain);
      }
    }
  }
  return { percent, regainMinutes };
}

export type Pacer = {
  take(): Stop | null;
  observe(headers: Headers): void;
  calls(): number;
  peak(): number;
};

export function createPacer(options: { maxCalls: number; stopAbovePercent?: number }): Pacer {
  const stopAbove = options.stopAbovePercent ?? META_USAGE_STOP_PERCENT;
  let calls = 0;
  let peak = 0;
  let regainMinutes = 0;
  return {
    take() {
      if (peak > stopAbove) {
        return {
          kind: "rate",
          message: `Meta reports ${peak}% of its call allowance used; pausing so publishing keeps its headroom.`,
          retryAfterMs: Math.max(HOUR_MS, regainMinutes * 60_000)
        };
      }
      if (calls >= options.maxCalls) {
        return { kind: "budget", message: `Used this run's ${options.maxCalls} calls.` };
      }
      calls += 1;
      return null;
    },
    observe(headers) {
      const usage = parseMetaUsage(headers);
      peak = Math.max(peak, usage.percent);
      regainMinutes = Math.max(regainMinutes, usage.regainMinutes);
    },
    calls: () => calls,
    peak: () => peak
  };
}

export function pacedRequest(pacer: Pacer | undefined, deps: HttpDeps) {
  return <T = unknown>(url: string, request: JsonRequest): Promise<T> => {
    if (!pacer) return requestJson<T>(url, request, deps);
    const stop = pacer.take();
    if (stop) return Promise.reject(new PacedStop(stop));
    return requestJson<T>(url, request, { ...deps, onResponse: pacer.observe });
  };
}
