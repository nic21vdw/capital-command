import { AnalyticsHttpError, classifyFailure, failureMessage } from "@/lib/analytics/http";
import type { FetchedPost } from "@/lib/analytics/types";

export type Stop = {
  kind: "auth" | "rate" | "scope" | "errors" | "quota" | "ledger" | "budget";
  message: string;
  retryAfterMs?: number;
  error?: unknown;
};

export class PacedStop extends Error {
  constructor(readonly stop: Stop) {
    super(stop.message);
    this.name = "PacedStop";
  }
}

export type FetchOutcome = {
  results: Map<string, FetchedPost>;
  gone: string[];
  failed: Array<{ postId: string; message: string }>;
  notes: string[];
  stopped: Stop | null;
};

export const MAX_CONSECUTIVE_FAILURES = 5;
export const RETIRED_ENDPOINT_REFUSALS = 10;

export function newOutcome(): FetchOutcome {
  return { results: new Map(), gone: [], failed: [], notes: [], stopped: null };
}

export function addNote(outcome: FetchOutcome, note: string): void {
  if (!outcome.notes.includes(note)) outcome.notes.push(note);
}

export function stopFromError(error: unknown): Stop | null {
  if (error instanceof PacedStop) return error.stop;
  const failure = classifyFailure(error);
  if (failure.kind === "auth" || failure.kind === "rate" || failure.kind === "scope") {
    return { kind: failure.kind, message: failureMessage(error), retryAfterMs: failure.retryAfterMs, error };
  }
  return null;
}

function isPostOwnRefusal(error: unknown): boolean {
  return error instanceof AnalyticsHttpError && error.status >= 400 && error.status < 500 && error.status !== 408;
}

export async function readEach(
  ids: string[],
  outcome: FetchOutcome,
  readOne: (id: string) => Promise<FetchedPost>
): Promise<void> {
  let consecutive = 0;
  let refusals = 0;
  for (const id of ids) {
    try {
      outcome.results.set(id, await readOne(id));
      consecutive = 0;
      refusals = 0;
    } catch (error) {
      if (!(error instanceof PacedStop) && classifyFailure(error).kind === "gone") {
        outcome.gone.push(id);
        consecutive = 0;
        continue;
      }
      const stop = stopFromError(error);
      if (stop) {
        outcome.stopped = stop;
        return;
      }
      outcome.failed.push({ postId: id, message: failureMessage(error) });
      if (isPostOwnRefusal(error)) {
        refusals += 1;
        if (refusals >= RETIRED_ENDPOINT_REFUSALS) {
          outcome.stopped = {
            kind: "errors",
            message: `The last ${refusals} posts were all refused (${failureMessage(error)}); the endpoint may be retired or changed.`
          };
          return;
        }
        continue;
      }
      consecutive += 1;
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        outcome.stopped = { kind: "errors", message: `${consecutive} reads in a row failed; the last said: ${failureMessage(error)}` };
        return;
      }
    }
  }
}
