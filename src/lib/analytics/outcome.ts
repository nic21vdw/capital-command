import { classifyFailure, failureMessage } from "@/lib/analytics/http";
import type { FetchedPost } from "@/lib/analytics/types";

export type Stop = {
  kind: "auth" | "rate" | "scope" | "errors";
  message: string;
  retryAfterMs?: number;
  error?: unknown;
};

export type FetchOutcome = {
  results: Map<string, FetchedPost>;
  gone: string[];
  failed: Array<{ postId: string; message: string }>;
  notes: string[];
  stopped: Stop | null;
};

export const MAX_CONSECUTIVE_FAILURES = 5;

export function newOutcome(): FetchOutcome {
  return { results: new Map(), gone: [], failed: [], notes: [], stopped: null };
}

export function addNote(outcome: FetchOutcome, note: string): void {
  if (!outcome.notes.includes(note)) outcome.notes.push(note);
}

export function stopFromError(error: unknown): Stop | null {
  const failure = classifyFailure(error);
  if (failure.kind === "auth" || failure.kind === "rate" || failure.kind === "scope") {
    return { kind: failure.kind, message: failureMessage(error), retryAfterMs: failure.retryAfterMs, error };
  }
  return null;
}

export async function readEach(
  ids: string[],
  outcome: FetchOutcome,
  readOne: (id: string) => Promise<FetchedPost>
): Promise<void> {
  let consecutive = 0;
  for (const id of ids) {
    try {
      outcome.results.set(id, await readOne(id));
      consecutive = 0;
    } catch (error) {
      if (classifyFailure(error).kind === "gone") {
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
      consecutive += 1;
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        outcome.stopped = { kind: "errors", message: `${consecutive} reads in a row failed; the last said: ${failureMessage(error)}` };
        return;
      }
    }
  }
}
