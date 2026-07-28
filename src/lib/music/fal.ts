/**
 * fal.ai queue client — the one transport every music model in the studio
 * shares. Unlike the reverse-engineered "Suno API" gateways, fal hosts these
 * models under its own commercial terms, so there is a real API to call and a
 * real licence behind the audio that comes back.
 *
 * Every fal endpoint speaks the same three routes, which is why one client
 * covers five very different models:
 *
 *   POST https://queue.fal.run/{endpointId}                        -> { request_id, status }
 *   GET  https://queue.fal.run/{endpointId}/requests/{id}/status   -> { status, queue_position }
 *   GET  https://queue.fal.run/{endpointId}/requests/{id}          -> the model's own output
 *
 * House AI pattern: *Configured() gate, pure request builder (see models.ts),
 * graceful fallback (no key configured -> clear error, never a thrown
 * exception).
 */

const DEFAULT_FAL_QUEUE_BASE = "https://queue.fal.run";

/** Overridable so a proxy — or a local stub in tests — can stand in for fal. */
function queueBase() {
  return (process.env.FAL_QUEUE_BASE || DEFAULT_FAL_QUEUE_BASE).replace(/\/+$/, "");
}

export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export type FalJobState =
  | { status: "pending"; queuePosition: number | null }
  | { status: "complete"; output: unknown }
  | { status: "failed"; error: string };

export function falConfigured() {
  return Boolean(process.env.FAL_KEY);
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    // fal's scheme is "Key <token>", not "Bearer".
    Authorization: `Key ${process.env.FAL_KEY}`
  };
}

/** Submits a generation to a model's queue. Never throws. */
export async function submitFalJob(
  endpointId: string,
  input: Record<string, unknown>
): Promise<{ requestId: string | null; error: string | null }> {
  if (!falConfigured()) {
    return { requestId: null, error: "FAL_KEY is not set — add it to .env to generate music." };
  }
  try {
    const response = await fetch(`${queueBase()}/${endpointId}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(input)
    });
    const data = (await response.json().catch(() => null)) as
      | { request_id?: string; detail?: unknown; error?: string }
      | null;
    if (!response.ok) {
      return { requestId: null, error: `fal rejected the request: ${describeFalError(data, response.status)}` };
    }
    const requestId = data?.request_id ?? null;
    if (!requestId) return { requestId: null, error: "fal did not return a request id." };
    return { requestId, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { requestId: null, error: `Could not reach fal (${message}).` };
  }
}

/**
 * Polls one queued generation. A COMPLETED status is followed immediately by
 * the result fetch, so callers get the model's output in a single round trip.
 * Never throws.
 */
export async function checkFalJob(endpointId: string, requestId: string): Promise<FalJobState> {
  if (!falConfigured()) return { status: "failed", error: "FAL_KEY is not set." };
  const id = encodeURIComponent(requestId);
  try {
    const statusResponse = await fetch(`${queueBase()}/${endpointId}/requests/${id}/status`, {
      headers: authHeaders(),
      cache: "no-store"
    });
    const statusData = (await statusResponse.json().catch(() => null)) as
      | { status?: FalQueueStatus; queue_position?: number; detail?: unknown; error?: string }
      | null;
    if (!statusResponse.ok) {
      return { status: "failed", error: `fal status check failed: ${describeFalError(statusData, statusResponse.status)}` };
    }
    if (statusData?.status !== "COMPLETED") {
      return { status: "pending", queuePosition: statusData?.queue_position ?? null };
    }

    const resultResponse = await fetch(`${queueBase()}/${endpointId}/requests/${id}`, {
      headers: authHeaders(),
      cache: "no-store"
    });
    const output = (await resultResponse.json().catch(() => null)) as Record<string, unknown> | null;
    if (!resultResponse.ok || !output) {
      return { status: "failed", error: `fal returned no result: ${describeFalError(output, resultResponse.status)}` };
    }
    return { status: "complete", output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { status: "failed", error: `Could not reach fal (${message}).` };
  }
}

/**
 * fal reports validation problems as a `detail` array of per-field errors and
 * everything else as a plain string, so both shapes are flattened into one
 * readable sentence. Pure, for tests.
 */
export function describeFalError(body: unknown, status: number): string {
  const data = body as { detail?: unknown; error?: string } | null;
  const detail = data?.detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((entry) => {
        const item = entry as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(".") : "";
        return field && item.msg ? `${field}: ${item.msg}` : item.msg || "";
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }
  if (typeof detail === "string" && detail) return detail;
  if (typeof data?.error === "string" && data.error) return data.error;
  return `HTTP ${status}`;
}
