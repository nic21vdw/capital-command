"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { YoutubeStat, YoutubeStatsResponse, YoutubeStatsStatus } from "@/lib/publisher/youtubeStatsShared";

/**
 * Client side of /api/publish/youtube-stats. One store for the whole page, so
 * the Day Summary's pieces and the Uploading Center's cards each ask for their
 * own video and the requests are batched into a single call. A screen that
 * stays open asks again after five minutes; the server still re-reads YouTube
 * at most every 30.
 */

export type StatsTarget = { itemId: string; videoId: string };

type Snapshot = {
  stats: Record<string, YoutubeStat>;
  status: YoutubeStatsStatus | "loading";
  message: string | null;
};

const REASK_AFTER_MS = 5 * 60 * 1000;
const BATCH_DELAY_MS = 60;

let snapshot: Snapshot = { stats: {}, status: "loading", message: null };
const listeners = new Set<() => void>();
const asked = new Map<string, number>();
const queued = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function flush() {
  timer = null;
  const batch = [...queued];
  queued.clear();
  if (batch.length === 0) return;
  try {
    const url = `/api/publish/youtube-stats?items=${batch.map(([itemId]) => encodeURIComponent(itemId)).join(",")}`;
    const response = await fetch(url, { cache: "no-store" });
    const body = (await response.json()) as YoutubeStatsResponse;
    publish({ stats: { ...snapshot.stats, ...body.stats }, status: body.status, message: body.message });
  } catch {
    // Offline or the route is down: keep whatever is already on screen.
    for (const [itemId] of batch) asked.delete(itemId);
    publish({ ...snapshot, status: Object.keys(snapshot.stats).length > 0 ? "stale" : "error" });
  }
}

function request(targets: StatsTarget[]) {
  const now = Date.now();
  let added = false;
  for (const { itemId, videoId } of targets) {
    const last = asked.get(itemId);
    if (last !== undefined && now - last < REASK_AFTER_MS) continue;
    asked.set(itemId, now);
    queued.set(itemId, videoId);
    added = true;
  }
  if (added && !timer) timer = setTimeout(() => void flush(), BATCH_DELAY_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: Snapshot = { stats: {}, status: "loading", message: null };

/** The numbers for these published YouTube posts, requested together with every other caller on the page. */
export function useYoutubeStats(targets: StatsTarget[]): Snapshot {
  const key = targets.map((target) => `${target.itemId}:${target.videoId}`).join("|");
  const stable = useMemo(
    () => targets,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the content of `targets`
    [key]
  );
  useEffect(() => {
    request(stable);
  }, [stable]);
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
}

/** Test seam: forget everything. */
export function resetYoutubeStatsStore() {
  snapshot = { stats: {}, status: "loading", message: null };
  asked.clear();
  queued.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}
