"use client";

import { useSyncExternalStore } from "react";
import { pollWhileVisible } from "@/lib/visiblePolling";

const POLL_MS = 60_000;

let unread = 0;
let stopPolling: (() => void) | null = null;
const listeners = new Set<() => void>();

export function setInboxUnread(count: number): void {
  if (count === unread) return;
  unread = count;
  for (const listener of listeners) listener();
}

async function read(): Promise<void> {
  try {
    const response = await fetch("/api/inbox?summary=1", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return;
    const body = (await response.json()) as { unread?: number };
    if (typeof body.unread === "number") setInboxUnread(body.unread);
  } catch {
    return;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  stopPolling ??= pollWhileVisible(read, POLL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopPolling?.();
      stopPolling = null;
    }
  };
}

export function useInboxUnread(): number {
  return useSyncExternalStore(
    subscribe,
    () => unread,
    () => 0
  );
}
