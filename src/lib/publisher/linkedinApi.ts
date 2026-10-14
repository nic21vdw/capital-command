import { PermanentError, ThrottledError, TransientError } from "@/lib/publisher/http";

export const LINKEDIN_API_ORIGIN = "https://api.linkedin.com";
export const LINKEDIN_REST = `${LINKEDIN_API_ORIGIN}/rest`;
export const LINKEDIN_COMMENTARY_LIMIT = 3000;
export const DEFAULT_LINKEDIN_VERSION = "202604";

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
  if (response.status === 408 || response.status >= 500) throw new TransientError(base);
  if (response.status === 403) {
    throw new PermanentError(
      `${base} LinkedIn refused the request: check that the app has the Share on LinkedIn product and that this account may post as the chosen author.`
    );
  }
  throw new PermanentError(base);
}

async function send(url: string, init: RequestInit, label: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new TransientError(`${label} network error: ${error instanceof Error ? error.message : String(error)}`);
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
  request: { body: Buffer; headers: Record<string, string>; label: string }
): Promise<Response> {
  return send(url, { method: "PUT", headers: request.headers, body: request.body as unknown as BodyInit }, request.label);
}
