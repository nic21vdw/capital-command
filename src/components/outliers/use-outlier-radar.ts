"use client";

import { useCallback, useState } from "react";
import type { Outlier, OutlierConfig, ScanRun, WatchlistChannel } from "@/lib/youtube/outliers";

/** Everything the Outlier Radar page renders, straight from /api/youtube/outliers. */
export type RadarState = {
  channels: WatchlistChannel[];
  outliers: Outlier[];
  runs: ScanRun[];
  config: OutlierConfig;
  configured: boolean;
};

/** Parses a JSON response, surfacing the API's { error } message on failure. */
export async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (HTTP ${response.status})`);
  return body;
}

// NOTE: the initial-fetch effect lives in OutliersPage — same split as
// use-uploading-center.ts, keeping react-hooks/set-state-in-effect happy.
export function useOutlierRadar() {
  const [state, setState] = useState<RadarState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await readJson<RadarState>(await fetch("/api/youtube/outliers", { cache: "no-store" }));
      setState(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return { state, setState, loadError, load };
}
