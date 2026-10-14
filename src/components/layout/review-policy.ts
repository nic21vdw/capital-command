"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_REVIEW_POLICY, type ReviewPolicy } from "@/lib/publisher/approval";

type Snapshot = { policy: ReviewPolicy; loaded: boolean; busy: boolean; error: string | null };

const INITIAL: Snapshot = { policy: DEFAULT_REVIEW_POLICY, loaded: false, busy: false, error: null };

let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function failure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `The request failed (${response.status}).`;
}

export async function loadReviewPolicy(): Promise<void> {
  try {
    const response = await fetch("/api/review/policy", { cache: "no-store" });
    if (!response.ok) throw new Error(await failure(response));
    const body = (await response.json()) as { policy: ReviewPolicy };
    publish({ policy: body.policy, loaded: true, error: null });
  } catch (reason) {
    publish({ loaded: true, error: reason instanceof Error ? reason.message : String(reason) });
  }
}

export async function changeReviewPolicy(change: Partial<ReviewPolicy>): Promise<boolean> {
  publish({ busy: true });
  try {
    const response = await fetch("/api/review/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change)
    });
    if (!response.ok) throw new Error(await failure(response));
    const body = (await response.json()) as { policy: ReviewPolicy };
    publish({ policy: body.policy, busy: false, error: null });
    return true;
  } catch (reason) {
    publish({ busy: false, error: reason instanceof Error ? reason.message : String(reason) });
    return false;
  }
}

export function useReviewPolicy(): Snapshot {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => INITIAL
  );
  useEffect(() => {
    void loadReviewPolicy();
  }, []);
  return state;
}
