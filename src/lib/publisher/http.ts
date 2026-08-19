/**
 * Small fetch helpers shared by the platform adapters. Errors are classified
 * so the runner knows whether to retry with backoff (transient) or mark the
 * platform failed with a reason (permanent).
 */

export class TransientError extends Error {
  readonly transient = true;
}

export class PermanentError extends Error {
  readonly transient = false;
}

/**
 * Thrown by adapters when the platform accepted the media but has not finished
 * processing it within this run. The runner records status "uploaded" with the
 * mid-flight handle so the next run resumes instead of re-sending the video.
 */
export class StillProcessingError extends TransientError {
  constructor(
    readonly containerId: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * The platform is refusing this post for a reason that clears with time, not
 * with a fix: a posting rate limit, or a backlog of uploads the creator has
 * not finished yet. Retrying in minutes would burn the item's attempts on a
 * wall that is still there, so the runner defers instead — the item keeps its
 * attempts and comes back when the window has actually moved.
 */
export class ThrottledError extends TransientError {
  constructor(
    readonly retryAfterMinutes: number,
    message: string
  ) {
    super(message);
  }
}

export class AbandonedUploadError extends TransientError {
  constructor(
    readonly containerId: string,
    message: string
  ) {
    super(message);
  }
}

export function isTransient(error: unknown): boolean {
  if (error instanceof TransientError) return true;
  if (error instanceof PermanentError) return false;
  // Network-level failures (DNS, reset, timeout) surface as generic errors.
  return true;
}

/** 408/429 and all 5xx are worth retrying; other 4xx are caller mistakes. */
function classifyStatus(status: number, message: string): TransientError | PermanentError {
  if (status === 408 || status === 429 || status >= 500) return new TransientError(message);
  return new PermanentError(message);
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Trims a body to a readable length for inclusion in an error message. */
function forMessage(text: string): string {
  return text.slice(0, 2000);
}

export type JsonRequest = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | Buffer;
  /** Label used in error messages, e.g. "YouTube resumable init". */
  label: string;
  /** Deadline for a JSON call. `fetchRaw` (media bytes) is never bounded. */
  timeoutMs?: number;
};

/**
 * A platform that accepts a connection and then says nothing holds the socket
 * open forever, and the browser only opens six per origin — one wedged profile
 * lookup used to starve every other request the page was making. Every JSON
 * call is small, so a deadline costs nothing and a hung one now fails as a
 * transient error the caller already knows how to fall back from.
 */
const JSON_TIMEOUT_MS = 20_000;

/** Performs a request and parses JSON, throwing classified errors. */
export async function fetchJson<T = Record<string, unknown>>(url: string, request: JsonRequest): Promise<T> {
  const response = await doFetch(url, { timeoutMs: JSON_TIMEOUT_MS, ...request });
  const text = await readBody(response);
  if (!response.ok) {
    throw classifyStatus(response.status, `${request.label} failed (HTTP ${response.status}): ${forMessage(text)}`);
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new PermanentError(`${request.label} returned unparseable JSON: ${text.slice(0, 200)}`);
  }
}

/** Performs a request where the caller needs the raw Response (e.g. headers). */
export async function fetchRaw(url: string, request: JsonRequest): Promise<Response> {
  const response = await doFetch(url, request);
  if (!response.ok) {
    const text = await readBody(response);
    throw classifyStatus(response.status, `${request.label} failed (HTTP ${response.status}): ${forMessage(text)}`);
  }
  return response;
}

async function doFetch(url: string, request: JsonRequest): Promise<Response> {
  try {
    return await fetch(url, {
      method: request.method ?? "POST",
      headers: request.headers,
      // Buffer is a valid BodyInit in Node but the DOM lib types don't know it.
      body: request.body as BodyInit | undefined,
      signal: request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined
    });
  } catch (error) {
    throw new TransientError(
      `${request.label} network error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
