import { useCallback, useState } from "react";

type Hist<T> = { past: T[]; present: T; future: T[]; commits: number };

function resolve<T>(next: T | ((prev: T) => T), prev: T): T {
  return typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
}

/**
 * Undo/redo history for an immutable value. `set` commits a new entry (clearing
 * redo), while `setLive` replaces the present without recording history — used
 * during continuous drags so a slide doesn't flood the undo stack. `commits`
 * (exposed as `version`) only advances on recorded edits, which autosave keys on.
 */
export function useHistory<T>(initial: T) {
  const [hist, setHist] = useState<Hist<T>>({ past: [], present: initial, future: [], commits: 0 });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setHist((h) => {
      const r = resolve(next, h.present);
      if (r === h.present) return h;
      return { past: [...h.past, h.present].slice(-100), present: r, future: [], commits: h.commits + 1 };
    });
  }, []);

  const setLive = useCallback((next: T | ((prev: T) => T)) => {
    setHist((h) => ({ ...h, present: resolve(next, h.present) }));
  }, []);

  /** Push an explicit prior value as the undo entry, then set `next` as present.
   * Records a single history step after a live drag of many `setLive`s. */
  const commitChange = useCallback((historyEntry: T, next: T) => {
    setHist((h) => ({ past: [...h.past, historyEntry].slice(-100), present: next, future: [], commits: h.commits + 1 }));
  }, []);

  const undo = useCallback(() => {
    setHist((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], commits: h.commits + 1 };
    });
  }, []);

  const redo = useCallback(() => {
    setHist((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1), commits: h.commits + 1 };
    });
  }, []);

  /** Replace history entirely (e.g. when opening a different project). */
  const reset = useCallback((value: T) => {
    setHist((h) => ({ past: [], present: value, future: [], commits: h.commits + 1 }));
  }, []);

  return {
    state: hist.present,
    set,
    setLive,
    commitChange,
    undo,
    redo,
    reset,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    version: hist.commits
  };
}
