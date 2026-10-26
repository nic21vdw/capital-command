import { PermanentError, ThrottledError, TransientError } from "@/lib/publisher/http";

export const LINKEDIN_API_ORIGIN = "https://api.linkedin.com";
export const LINKEDIN_REST = `${LINKEDIN_API_ORIGIN}/rest`;
export const LINKEDIN_COMMENTARY_LIMIT = 3000;
export const DEFAULT_LINKEDIN_VERSION = "202604";

export const LINKEDIN_UPLOAD_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_PER_10_MB_MS = 30_000;
const TEN_MB = 10 * 1024 * 1024;

export function linkedinUploadTimeoutMs(bytes: number): number {
  return LINKEDIN_UPLOAD_TIMEOUT_MS + Math.ceil(Math.max(0, bytes) / TEN_MB) * UPLOAD_TIMEOUT_PER_10_MB_MS;
}

const UNSENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPROTO",
  "UND_ERR_CONNECT_TIMEOUT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID"
]);

function unsentCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && (UNSENT_CODES.has(code) || code.startsWith("ERR_SSL_"))) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const JSON_TIMEOUT_MS = 30_000;
const RESET_GRACE_MINUTES = 5;
const MAX_THROTTLE_MINUTES = 24 * 60 + RESET_GRACE_MINUTES;
const RESERVED_CHARACTERS = /[\\|{}@[\]()<>#*_~]/g;
const HASHTAG = /(^|\s)#([\p{L}\p{N}_]+)/gu;

export function linkedinVersion(): string {
  const raw = process.env.LINKEDIN_API_VERSION?.trim();
  return raw && /^\d{6}$/.test(raw) ? raw : DEFAULT_LINKEDIN_VERSION;
}

function escapeReserved(text: string): string {
  return text.replace(RESERVED_CHARACTERS, (character) => `\\${character}`);
}

function convertCommentary(text: string): string {
  let out = "";
  let cursor = 0;
  for (const match of text.matchAll(HASHTAG)) {
    const index = match.index ?? 0;
    out += `${escapeReserved(text.slice(cursor, index))}${match[1]}{hashtag|\\#|${escapeReserved(match[2])}}`;
    cursor = index + match[0].length;
  }
  return out + escapeReserved(text.slice(cursor));
}

export function littleText(text: string): string {
  let raw = text;
  let out = convertCommentary(raw);
  while (out.length > LINKEDIN_COMMENTARY_LIMIT) {
    raw = raw.slice(0, Math.max(0, raw.length - Math.max(1, Math.ceil((out.length - LINKEDIN_COMMENTARY_LIMIT) / 2))));
    out = convertCommentary(raw);
  }
  return out;
}

export function minutesUntilUtcReset(now: Date = new Date()): number {
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((nextMidnight - now.getTime()) / 60_000) + RESET_GRACE_MINUTES;
}

export function throttleMinutes(response: Response, now: Date = new Date()): number {
  const header = response.headers.get("retry-after")?.trim();
  if (header) {
    const seconds = Number(header);
    const waitMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now.getTime();
    if (Number.isFinite(waitMs) && waitMs > 0) return Math.min(MAX_THROTTLE_MINUTES, Math.max(1, Math.ceil(waitMs / 60_000)));
  }
  return minutesUntilUtcReset(now);
}

export class LinkedinPermanentError extends PermanentError {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
  }
}

export class LinkedinUnsentError extends TransientError {}

export class LinkedinTransientError extends TransientError {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export type LinkedinRequest = {
  method?: string;
  token: string;
  label: string;
  body?: unknown;
  headers?: Record<string, string>;
};

async function bodyText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

async function fail(response: Response, label: string): Promise<never> {
  const text = await bodyText(response);
  const base = `${label} failed (HTTP ${response.status}): ${text}`;
  if (response.status === 429) {
    const minutes = throttleMinutes(response);
    throw new ThrottledError(
      minutes,
      `${label} was rate limited by LinkedIn (HTTP 429): ${text} LinkedIn's daily limits reset at midnight UTC - trying again in ${minutes} minutes, and the post keeps its place.`
    );
  }
  if (response.status === 408 || response.status >= 500) throw new LinkedinTransientError(base, response.status);
  if (response.status === 403) {
    throw new LinkedinPermanentError(
      `${base} LinkedIn refused the request: check that the app has the Share on LinkedIn product and that this account may post as the chosen author.`,
      response.status,
      text
    );
  }
  throw new LinkedinPermanentError(base, response.status, text);
}

async function send(url: string, init: RequestInit, label: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const code = unsentCode(error);
    if (code) throw new LinkedinUnsentError(`${label} network error (nothing was sent, ${code}): ${reason}`);
    throw new TransientError(`${label} network error: ${reason}`);
  }
  if (!response.ok) await fail(response, label);
  return response;
}

export async function linkedinCall(url: string, request: LinkedinRequest): Promise<Response> {
  const json = request.body !== undefined && typeof request.body === "object" && !Buffer.isBuffer(request.body);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${request.token}`,
    "LinkedIn-Version": linkedinVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...request.headers
  };
  return send(
    url,
    {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : json ? JSON.stringify(request.body) : (request.body as BodyInit),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS)
    },
    request.label
  );
}

export async function linkedinJson<T>(url: string, request: LinkedinRequest): Promise<T> {
  const response = await linkedinCall(url, request);
  const text = await response.text();
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new PermanentError(`${request.label} returned unparseable JSON: ${text.slice(0, 200)}`);
  }
}

export async function linkedinUpload(
  url: string,
  request: { body: Buffer; headers: Record<string, string>; label: string; timeoutMs?: number }
): Promise<Response> {
  return send(
    url,
    {
      method: "PUT",
      headers: request.headers,
      body: request.body as unknown as BodyInit,
      signal: AbortSignal.timeout(request.timeoutMs ?? LINKEDIN_UPLOAD_TIMEOUT_MS)
    },
    request.label
  );
}
