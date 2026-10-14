"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const POLL_MS = 60_000;

const LeadsContext = createContext(0);
const RefreshContext = createContext<() => void>(() => {});

export function ListeningLeadsProvider({ children }: { children: React.ReactNode }) {
  const [leads, setLeads] = useState(0);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const response = await fetch("/api/listening?summary=1", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) return;
        const json = (await response.json()) as { newLeads?: number };
        if (alive && typeof json.newLeads === "number") setLeads(json.newLeads);
      } catch {
        return;
      }
    };
    refreshRef.current = () => void read();
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const refresh = useCallback(() => refreshRef.current(), []);

  return (
    <LeadsContext.Provider value={leads}>
      <RefreshContext.Provider value={refresh}>{children}</RefreshContext.Provider>
    </LeadsContext.Provider>
  );
}

export function useListeningLeads() {
  return useContext(LeadsContext);
}

export function useRefreshListeningLeads() {
  return useContext(RefreshContext);
}
