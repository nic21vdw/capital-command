"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { differenceInSeconds, parseISO } from "date-fns";
import {
  addSession,
  getServerSnapshot,
  getSnapshot,
  isHydrated,
  patchSession,
  removeSession,
  resetAll as storeResetAll,
  setActiveSession,
  subscribe
} from "@/lib/progress/store";
import { deriveProgress } from "@/lib/progress/calculations";
import { toLocalDateKey } from "@/lib/progress/date-utils";
import type {
  ActiveSession,
  DerivedProgress,
  Session
} from "@/types/progress";

interface UseProgressTracker {
  loading: boolean;
  progress: DerivedProgress;
  liveElapsedSeconds: number;
  startSession: () => void;
  endSession: () => void;
  endSessionAt: (endTime: string) => void;
  cancelActiveSession: () => void;
  deleteSession: (id: string) => void;
  updateSession: (id: string, patch: Partial<Pick<Session, "startTime" | "endTime">>) => void;
  resetAll: () => void;
}

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionFromInterval(start: string, end: string): Session {
  const startDate = parseISO(start);
  const endDate = parseISO(end);
  const durationMinutes = Math.max(
    0,
    Math.round((endDate.getTime() - startDate.getTime()) / 60000)
  );
  return {
    id: newId("session"),
    startTime: start,
    endTime: end,
    durationMinutes,
    date: toLocalDateKey(startDate)
  };
}

export function useProgressTracker(): UseProgressTracker {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [now, setNow] = useState(() => new Date());

  // Live ticker while a session is active. Re-renders every second so the
  // visible timer updates and any derived "today" comparisons stay current.
  useEffect(() => {
    if (!state.activeSession) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [state.activeSession]);

  const startSession = useCallback(() => {
    if (getSnapshot().activeSession) return; // guard against double-start
    const active: ActiveSession = {
      id: newId("active"),
      startTime: new Date().toISOString()
    };
    setActiveSession(active);
  }, []);

  const endSessionAt = useCallback((endTime: string) => {
    const current = getSnapshot();
    if (!current.activeSession) return;
    const session = sessionFromInterval(current.activeSession.startTime, endTime);
    if (session.durationMinutes <= 0) {
      // Discard zero-length sessions so a fat-finger Start/End doesn't pollute history.
      setActiveSession(null);
      return;
    }
    addSession(session);
  }, []);

  const endSession = useCallback(() => {
    endSessionAt(new Date().toISOString());
  }, [endSessionAt]);

  const cancelActiveSession = useCallback(() => {
    setActiveSession(null);
  }, []);

  const deleteSession = useCallback((id: string) => {
    removeSession(id);
  }, []);

  const updateSession = useCallback(
    (id: string, patch: Partial<Pick<Session, "startTime" | "endTime">>) => {
      const current = getSnapshot();
      const existing = current.sessions.find((s) => s.id === id);
      if (!existing) return;
      const startTime = patch.startTime ?? existing.startTime;
      const endTime = patch.endTime ?? existing.endTime;
      const startDate = parseISO(startTime);
      const endDate = parseISO(endTime);
      const durationMinutes = Math.max(
        0,
        Math.round((endDate.getTime() - startDate.getTime()) / 60000)
      );
      patchSession(id, {
        ...existing,
        startTime,
        endTime,
        durationMinutes,
        date: toLocalDateKey(startDate)
      });
    },
    []
  );

  const resetAll = useCallback(() => {
    storeResetAll();
  }, []);

  const progress = useMemo(
    () => deriveProgress(state.sessions, state.activeSession, now),
    [state.sessions, state.activeSession, now]
  );

  const liveElapsedSeconds = state.activeSession
    ? Math.max(0, differenceInSeconds(now, parseISO(state.activeSession.startTime)))
    : 0;

  return {
    loading: !isHydrated(),
    progress,
    liveElapsedSeconds,
    startSession,
    endSession,
    endSessionAt,
    cancelActiveSession,
    deleteSession,
    updateSession,
    resetAll
  };
}
