// In-memory store backed by the persistence adapter, exposed through the
// subscribe / getSnapshot interface so React components can read it via
// `useSyncExternalStore`. This is the React 19 idiomatic way to bind to an
// external source like localStorage.

import { progressStorage } from "./storage";
import type { PersistedProgress, Session, ActiveSession } from "@/types/progress";

const EMPTY: PersistedProgress = { sessions: [], activeSession: null };

let snapshot: PersistedProgress = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function set(next: PersistedProgress) {
  snapshot = next;
  progressStorage.save(next);
  notify();
}

export function subscribe(listener: () => void): () => void {
  // Hydrate the in-memory snapshot from storage the first time anyone
  // subscribes (i.e. first time we're on the client and a component mounts).
  if (!hydrated) {
    hydrated = true;
    snapshot = progressStorage.load();
    // Defer the notify so subscribers added during this microtask still see it.
    queueMicrotask(notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): PersistedProgress {
  return snapshot;
}

export function getServerSnapshot(): PersistedProgress {
  return EMPTY;
}

export function isHydrated(): boolean {
  return hydrated;
}

// ---- Mutations ----

export function setActiveSession(active: ActiveSession | null) {
  set({ ...snapshot, activeSession: active });
}

export function addSession(session: Session) {
  set({
    sessions: [...snapshot.sessions, session],
    activeSession: null
  });
}

export function removeSession(id: string) {
  set({
    ...snapshot,
    sessions: snapshot.sessions.filter((s) => s.id !== id)
  });
}

export function patchSession(id: string, next: Session) {
  set({
    ...snapshot,
    sessions: snapshot.sessions.map((s) => (s.id === id ? next : s))
  });
}

export function resetAll() {
  progressStorage.clear();
  snapshot = EMPTY;
  notify();
}
