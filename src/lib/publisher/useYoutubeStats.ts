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
  /** A request for numbers is queued or on its way; a screen shows a loading state rather than "no numbers". */
  pending: boolean;
  /** The Refresh button's request is on its way. */
  refreshing: boolean;
  /** When (ms since epoch) the last answer arrived from the app, or null before the first. */
  checkedAt: number | null;
};

const REASK_AFTER_MS = 5 * 60 * 1000;
const BATCH_DELAY_MS = 60;

let snapshot: Snapshot = { stats: {}, status: "loading", message: null, pending: false, refreshing: false, checkedAt: null };
let inFlight = 0;
const listeners = new Set<() => void>();
const asked = new Map<string, number>();
const queued = new Map<string, string>();
/** Every post any caller has asked about, so Refresh can ask about all of them again. */
const known = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next, pending: queued.size > 0 || inFlight > 0 };
  for (const listener of listeners) listener();
}

/** Re-publish only when "is a request outstanding" actually changed. */
function publishPending() {
  const pending = queued.size > 0 || inFlight > 0;
  if (pending !== snapshot.pending) publish(snapshot);
}

async function flush() {
  timer = null;
  const batch = [...queued];
  queued.clear();
  if (batch.length === 0) return;
  inFlight += 1;
  try {
    const url = `/api/publish/youtube-stats?items=${batch.map(([itemId]) => encodeURIComponent(itemId)).join(",")}`;
    const response = await fetch(url, { cache: "no-store" });
    const body = (await response.json()) as YoutubeStatsResponse;
    inFlight -= 1;
    publish({ stats: { ...snapshot.stats, ...body.stats }, status: body.status, message: body.message, checkedAt: Date.now() });
  } catch {
    inFlight -= 1;
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
    known.set(itemId, videoId);
    added = true;
  }
  if (added && !timer) timer = setTimeout(() => void flush(), BATCH_DELAY_MS);
  if (added) publishPending();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: Snapshot = { stats: {}, status: "loading", message: null, pending: false, refreshing: false, checkedAt: null };

/** Posts to ask about in one Refresh; the route reads at most this many. */
const MAX_REFRESH_ITEMS = 200;

/**
 * The Refresh button: ask again now for every post on the page instead of
 * waiting out the five-minute re-ask. The route still holds a one-minute floor
 * per video and its own back-off, so this cannot spend more quota than it
 * should. A failure keeps the numbers on screen and says so in `message`.
 */
export async function refreshYoutubeStats(): Promise<void> {
  if (snapshot.refreshing) return;
  const batch = [...known].slice(0, MAX_REFRESH_ITEMS);
  if (batch.length === 0) return;
  publish({ refreshing: true });
  try {
    const url = `/api/publish/youtube-stats?refresh=1&items=${batch.map(([itemId]) => encodeURIComponent(itemId)).join(",")}`;
    const response = await fetch(url, { cache: "no-store" });
    const body = (await response.json()) as YoutubeStatsResponse;
    publish({ stats: { ...snapshot.stats, ...body.stats }, status: body.status, message: body.message, checkedAt: Date.now(), refreshing: false });
  } catch {
    publish({
      status: Object.keys(snapshot.stats).length > 0 ? "stale" : "error",
      message: "The app could not be reached, so these are the last numbers it had.",
      checkedAt: Date.now(),
      refreshing: false
    });
  }
}

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
  snapshot = { stats: {}, status: "loading", message: null, pending: false, refreshing: false, checkedAt: null };
  inFlight = 0;
  known.clear();
  asked.clear();
  queued.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}
