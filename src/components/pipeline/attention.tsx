"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useColateralBridge } from "@/components/providers/colateral-bridge-provider";
import type { AttentionBreakdown } from "@/lib/attention/failures";
import type { AppNotification } from "@/lib/colateral/protocol";
import { readPipelineSummary } from "@/lib/pipeline/summaryClient";

// How many runs are asking for something. Nothing used to tell Nic a stage had
// broken unless he opened the Pipeline and read the flow — an overnight failure
// could sit there all day. One provider for the whole shell, same rule as the
// release status: two components polling would disagree on screen, and every
// poll also advances the runs server-side.

export type ScanOutcome = {
  at: string;
  status: "ok" | "failed" | "not-connected" | "needs-reconnect" | "stale";
  staleSince?: string;
  error?: string;
  ingested?: number;
};

type Attention = {
  /** Everything asking for attention: stream problems plus failed posts. */
  needsAttention: number;
  working: number;
  scan?: ScanOutcome | null;
  /** How `needsAttention` splits into stream problems, failed posts and failed Threads posts. */
  breakdown: AttentionBreakdown;
  /** The failed posts behind the count, as bridge notifications. */
  failures: AppNotification[];
};

const NO_BREAKDOWN: AttentionBreakdown = { pipeline: 0, publish: 0, threads: 0 };
const NO_FAILURES: AppNotification[] = [];

const PipelineAttentionContext = createContext<Attention>({
  needsAttention: 0,
  working: 0,
  breakdown: NO_BREAKDOWN,
  failures: NO_FAILURES
});
const RefreshAttentionContext = createContext<() => void>(() => {});

const POLL_MS = 60_000;

export function PipelineAttentionProvider({ children }: { children: React.ReactNode }) {
  const [attention, setAttention] = useState<Attention>({
    needsAttention: 0,
    working: 0,
    breakdown: NO_BREAKDOWN,
    failures: NO_FAILURES
  });
  // Every route with its own `metadata.title` rewrites the title on arrival, so
  // the count has to be re-applied per navigation — the provider itself never
  // remounts.
  const pathname = usePathname();
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    const read = async () => {
      // Offline or mid-restart reads answer null: keep the last count rather
      // than clearing it.
      const data = (await readPipelineSummary()) as Attention | null;
      if (!data || !alive) return;
      const needsAttention = data.needsAttention ?? 0;
      setAttention({
        needsAttention,
        working: data.working ?? 0,
        scan: data.scan ?? null,
        // An older server answers without a breakdown: everything it counted
        // was a stream problem.
        breakdown: {
          pipeline: data.breakdown?.pipeline ?? (data.breakdown ? 0 : needsAttention),
          publish: data.breakdown?.publish ?? 0,
          threads: data.breakdown?.threads ?? 0
        },
        failures: Array.isArray(data.failures) ? (data.failures as AppNotification[]) : NO_FAILURES
      });
    };
    refreshRef.current = () => void read();
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // The window is usually behind something else — this app runs as its own
  // taskbar window all day. Putting the count in the title is the one signal
  // that reaches him without asking for notification permission.
  //
  // Next writes each route's own <title> AFTER hydration, so setting this once
  // per value was silently undone on the first load — the case the count exists
  // for. Watching the title element is what makes it stick.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const apply = () => {
      const base = document.title.replace(/^\(\d+\)\s*/, "");
      // Before the route's own title lands there is nothing to prefix, and
      // writing "(1)" alone would leave the window with no name at all.
      if (!base) return;
      const wanted = attention.needsAttention > 0 ? `(${attention.needsAttention}) ${base}` : base;
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const head = document.querySelector("title")?.parentElement ?? document.head;
    const observer = new MutationObserver(apply);
    observer.observe(head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [attention.needsAttention, pathname]);

  // Tell the CoLateral host about each new failure, once. The bridge decides
  // whether it can (framed, and the host has spoken) and remembers what it sent.
  const { notify, ready } = useColateralBridge();
  useEffect(() => {
    if (!ready) return;
    for (const failure of attention.failures) notify(failure);
  }, [attention.failures, notify, ready]);

  const refresh = useCallback(() => refreshRef.current(), []);

  return (
    <PipelineAttentionContext.Provider value={attention}>
      <RefreshAttentionContext.Provider value={refresh}>{children}</RefreshAttentionContext.Provider>
    </PipelineAttentionContext.Provider>
  );
}


export function usePipelineAttention() {
  return useContext(PipelineAttentionContext);
}

/** Re-read the count now, rather than up to a minute after acting on it. */
export function useRefreshAttention() {
  return useContext(RefreshAttentionContext);
}
