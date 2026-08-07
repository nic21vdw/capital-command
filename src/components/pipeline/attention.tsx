"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

// How many runs are asking for something. Nothing used to tell Nic a stage had
// broken unless he opened the Pipeline and read the flow — an overnight failure
// could sit there all day. One provider for the whole shell, same rule as the
// release status: two components polling would disagree on screen, and every
// poll also advances the runs server-side.

export type ScanOutcome = {
  at: string;
  status: "ok" | "failed" | "not-connected" | "needs-reconnect";
  error?: string;
  ingested?: number;
};

type Attention = { needsAttention: number; working: number; scan?: ScanOutcome | null };

const PipelineAttentionContext = createContext<Attention>({ needsAttention: 0, working: 0 });

const POLL_MS = 60_000;

export function PipelineAttentionProvider({ children }: { children: React.ReactNode }) {
  const [attention, setAttention] = useState<Attention>({ needsAttention: 0, working: 0 });
  // Every route with its own `metadata.title` rewrites the title on arrival, so
  // the count has to be re-applied per navigation — the provider itself never
  // remounts.
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const response = await fetch("/api/pipeline?summary=1", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as Attention;
        if (alive) {
          setAttention({
            needsAttention: data.needsAttention ?? 0,
            working: data.working ?? 0,
            scan: data.scan ?? null
          });
        }
      } catch {
        // Offline or mid-restart: keep the last count rather than clearing it.
      }
    };
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

  return <PipelineAttentionContext.Provider value={attention}>{children}</PipelineAttentionContext.Provider>;
}

export function usePipelineAttention() {
  return useContext(PipelineAttentionContext);
}
