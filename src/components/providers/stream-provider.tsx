"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { readPipelineSummary } from "@/lib/pipeline/summaryClient";
import type { StreamSummary } from "@/lib/pipeline/types";

/**
 * The stream you are working on, for the whole shell.
 *
 * Every Formats screen used to be a flat list of everything the app had ever
 * made, and the run you had open lived in the Pipeline page's own state — so
 * walking from the pipeline to the Clip Editor lost it, and nothing on screen
 * said which recording you were looking at. This holds that answer above the
 * routes, so the sidebar can name it and every screen can filter to it.
 *
 * The list rides the same poll the attention badge makes; the SELECTION is
 * local to this browser and survives a restart, because it is a working state,
 * not something the server has an opinion about.
 */

const SELECTED_KEY = "capital-command:stream";
// Each route mounts its own AppShell, so the provider remounts on every
// navigation. Without a cache the header would blink "Every stream" and then
// the name back in on each one, which is exactly the scattered feeling this
// exists to fix. Same trick the connected-accounts card uses.
const CACHE_KEY = "capital-command:streams";
const POLL_MS = 60_000;

function cachedStreams(): StreamSummary[] {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as StreamSummary[]) : [];
  } catch {
    return [];
  }
}

type StreamContextValue = {
  streams: StreamSummary[];
  stream: StreamSummary | null;
  /** Whether the list has been read at least once — before that, "no streams" is not yet true. */
  loaded: boolean;
  select: (id: string | null) => void;
};

const StreamContext = createContext<StreamContextValue>({
  streams: [],
  stream: null,
  loaded: false,
  select: () => {}
});

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Read after mount, off the render pass: reading localStorage in the state
  // initializer makes the client's first render disagree with the server HTML.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = window.localStorage.getItem(SELECTED_KEY);
        if (stored) setSelectedId(stored);
        const cached = cachedStreams();
        if (cached.length > 0) setStreams(cached);
      } catch {
        // Non-critical preference read.
      }
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      // Offline or mid-restart reads answer null: keep the last list rather
      // than emptying the sidebar, which would read as "you have no streams".
      const data = (await readPipelineSummary()) as { streams?: StreamSummary[] } | null;
      if (!data || !alive) return;
      const next = data.streams ?? [];
      setStreams(next);
      setLoaded(true);
      try {
        window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        // Cache is an optimisation; a full quota is not a failure.
      }
    };
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) window.localStorage.setItem(SELECTED_KEY, id);
    else window.localStorage.removeItem(SELECTED_KEY);
  }, []);

  const value = useMemo<StreamContextValue>(() => {
    // A deleted stream must not leave the shell pointing at a name that is gone.
    const stream = streams.find((entry) => entry.id === selectedId) ?? null;
    return { streams, stream, loaded, select };
  }, [streams, selectedId, loaded, select]);

  return (
    <StreamContext.Provider value={value}>
      {/* Only this leaf reads the query string. Suspending the whole shell for
          it would prerender every page as an empty fallback. */}
      <Suspense fallback={null}>
        <RunParamSync select={select} />
      </Suspense>
      {children}
    </StreamContext.Provider>
  );
}

/**
 * Opening a run on the Pipeline page IS choosing what you are working on.
 * Without this the sidebar would still name yesterday's stream while you read
 * today's, which is worse than naming nothing.
 */
function RunParamSync({ select }: { select: (id: string | null) => void }) {
  const pathname = usePathname();
  const runParam = useSearchParams().get("run");
  useEffect(() => {
    if (!runParam) return;
    if (pathname !== "/" && pathname !== "/pipeline") return;
    select(runParam);
  }, [runParam, pathname, select]);
  return null;
}

export function useStream() {
  return useContext(StreamContext);
}
