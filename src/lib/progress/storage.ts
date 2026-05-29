// Persistence adapter for the progress tracker.
//
// Today this is localStorage. The shape of `ProgressStorageAdapter` is the only
// thing the rest of the app depends on, so this layer can be swapped for a
// JSON file, SQLite, or a backend without touching the UI.

import type { PersistedProgress } from "@/types/progress";

const STORAGE_KEY = "colateral-progress-v1";

export interface ProgressStorageAdapter {
  load(): PersistedProgress;
  save(data: PersistedProgress): void;
  clear(): void;
}

const EMPTY: PersistedProgress = { sessions: [], activeSession: null };

export function createLocalStorageAdapter(): ProgressStorageAdapter {
  return {
    load() {
      if (typeof window === "undefined") return EMPTY;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return EMPTY;
        const parsed = JSON.parse(raw) as PersistedProgress;
        if (!parsed || !Array.isArray(parsed.sessions)) return EMPTY;
        return {
          sessions: parsed.sessions,
          activeSession: parsed.activeSession ?? null
        };
      } catch {
        return EMPTY;
      }
    },
    save(data) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    clear() {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };
}

export const progressStorage = createLocalStorageAdapter();
