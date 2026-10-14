import { isAuthFailure } from "@/lib/platform-health/auth";

export type HttpDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxInlineWaitMs?: number;
  timeoutMs?: number;
  onResponse?: (headers: Headers) => void;
};

export type JsonRequest = {
  label: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
};

export class AnalyticsHttpError extends Error {
  constructor(
    label: string,
    readonly status: number,
    readonly body: string
  ) {
    super(`${label} failed (HTTP ${status}): ${body.slice(0, 500)}`);
    this.name = "AnalyticsHttpError";
  }
}

export class RateLimitedError extends Error {
  constructor(
    label: string,
    readonly retryAfterMs: number
  ) {
    super(`${label} was rate limited (HTTP 429); retry in ${Math.ceil(retryAfterMs / 1000)} s`);
    this.name = "RateLimitedError";
  }
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_INLINE_WAIT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RATE_WAIT_MS = 60 * 60_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function requestJson<T = unknown>(url: string, request: JsonRequest, deps: HttpDeps = {}): Promise<T> {
  const send = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const maxRetries = deps.maxRetries ?? DEFAULT_RETRIES;
  const baseDelay = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = deps.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxInline = deps.maxInlineWaitMs ?? DEFAULT_MAX_INLINE_WAIT_MS;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await send(url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      });
    } catch (error) {
      throw new Error(`${request.label} network error: ${error instanceof Error ? error.message : String(error)}`);
    }

    deps.onResponse?.(response.headers);

    if (response.ok) {
      const text = await response.text().catch(() => "");
      try {
        return (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new Error(`${request.label} returned unparseable JSON: ${text.slice(0, 200)}`);
      }
    }

    const body = await response.text().catch(() => "");
    const advised = retryAfterMs(response);
    const retryable = RETRY_STATUSES.has(response.status) && attempt < maxRetries;
    const wait = advised ?? Math.min(baseDelay * 2 ** attempt, maxDelay);

    if (retryable && wait <= maxInline) {
      await sleep(wait);
      continue;
    }
    if (response.status === 429) throw new RateLimitedError(request.label, advised ?? DEFAULT_RATE_WAIT_MS);
    throw new AnalyticsHttpError(request.label, response.status, body);
  }
}

export type FailureKind = "auth" | "rate" | "scope" | "gone" | "other";

export type Failure = { kind: FailureKind; retryAfterMs?: number };

const SCOPE_PATTERNS: RegExp[] = [
  /insufficientPermissions/i,
  /ACCESS_TOKEN_SCOPE_INSUFFICIENT/,
  /insufficient authentication scopes/i,
  /scope_not_authorized/,
  /SERVICE_DISABLED/,
  /has not been used in project/i,
  /"code"\s*:\s*10\b/,
  /\(#10\)/,
  /"code"\s*:\s*200\b/,
  /\(#200\)/
];

const RATE_PATTERNS: RegExp[] = [
  /quotaExceeded|rateLimitExceeded|dailyLimitExceeded|userRateLimitExceeded/,
  /"code"\s*:\s*(?:4|17|32|613|8000[1-6])\b/,
  /\(#(?:4|17|32|613)\)/
];

const GONE_PATTERNS: RegExp[] = [/"error_subcode"\s*:\s*33\b/, /\bdoes not exist\b/i, /unknown path components/i];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function classifyFailure(error: unknown): Failure {
  if (error instanceof RateLimitedError) return { kind: "rate", retryAfterMs: error.retryAfterMs };
  const message = messageOf(error);
  const status = error instanceof AnalyticsHttpError ? error.status : null;
  if (SCOPE_PATTERNS.some((pattern) => pattern.test(message))) return { kind: "scope" };
  if (isAuthFailure(error)) return { kind: "auth" };
  if (status === 429 || RATE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "rate", retryAfterMs: DEFAULT_RATE_WAIT_MS };
  }
  if (/missing permissions?/i.test(message)) return { kind: "other" };
  if (status === 404 || GONE_PATTERNS.some((pattern) => pattern.test(message))) return { kind: "gone" };
  return { kind: "other" };
}

export function failureMessage(error: unknown): string {
  return messageOf(error).slice(0, 300);
}
