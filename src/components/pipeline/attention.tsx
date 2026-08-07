"use client";

import { createContext, useContext, useEffect, useState } from "react";

// How many runs are asking for something. Nothing used to tell Nic a stage had
// broken unless he opened the Pipeline and read the flow — an overnight failure
// could sit there all day. One provider for the whole shell, same rule as the
// release status: two components polling would disagree on screen, and every
// poll also advances the runs server-side.

type Attention = { needsAttention: number; working: number };

const PipelineAttentionContext = createContext<Attention>({ needsAttention: 0, working: 0 });

const POLL_MS = 60_000;

export function PipelineAttentionProvider({ children }: { children: React.ReactNode }) {
  const [attention, setAttention] = useState<Attention>({ needsAttention: 0, working: 0 });

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const response = await fetch("/api/pipeline?summary=1", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as Attention;
        if (alive) setAttention({ needsAttention: data.needsAttention ?? 0, working: data.working ?? 0 });
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

  return <PipelineAttentionContext.Provider value={attention}>{children}</PipelineAttentionContext.Provider>;
}

export function usePipelineAttention() {
  return useContext(PipelineAttentionContext);
}
