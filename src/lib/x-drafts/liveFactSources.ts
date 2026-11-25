import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { rowsFromStore } from "@/lib/analytics/query";
import { readMetrics } from "@/lib/analytics/store";
import { readLedger } from "@/lib/ingest/ledger";
import { dataPath } from "@/lib/paths";
import { youtubeAccessToken } from "@/lib/publisher/adapters/youtube";
import { fetchJson } from "@/lib/publisher/http";
import { localCalendarParts } from "@/lib/publisher/time";
import { atomicWriteJson, readJson } from "@/lib/storage/atomic-json";
import { debitOrSkip } from "@/lib/youtube/quotaSpend";
import type { DatedFact } from "@/lib/x-drafts/facts";
import {
  commitFacts,
  liveFactsFrom,
  mergeSnapshot,
  releaseFacts,
  streamFacts,
  streamNoteFacts,
  subscriberFacts,
  videoFacts,
  type LiveFactsSnapshot,
  type LiveSource,
  type ReleaseEntry,
  type SourceSnapshot,
  type StreamRun
} from "@/lib/x-drafts/liveFacts";

export const LIVE_FACTS_FILE = "x-drafts-live-facts.json";
const TIMEOUT_MS = 15_000;
const GITHUB_API = "https://api.github.com";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function repoPath(name: string, fallback: string[]): string | null {
  const value = env(name);
  if (value.toLowerCase() === "off") return null;
  return value || path.join(homedir(), ...fallback);
}

function git(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
}

async function mainLog(repo: string): Promise<string> {
  if (!existsSync(repo)) throw new Error(`no checkout at ${repo}`);
  const args = ["--first-parent", "--since=10 days ago", "--format=%cs%x09%s", "-n", "80"];
  for (const ref of ["origin/main", "main"]) {
    try {
      return await git(["-C", repo, "log", ref, ...args]);
    } catch {
      continue;
    }
  }
  throw new Error(`no main branch in ${repo}`);
}

async function subscriberCount(): Promise<{ subscribers: number | null; hidden: boolean }> {
  await debitOrSkip(1, "channel");
  const token = await youtubeAccessToken();
  const body = await fetchJson<{ items?: Array<{ statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }> }>(
    "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true",
    { label: "YouTube subscriber count", method: "GET", headers: { Authorization: `Bearer ${token}` } }
  );
  const stats = body.items?.[0]?.statistics;
  const count = Number(stats?.subscriberCount);
  return { subscribers: Number.isFinite(count) ? count : null, hidden: Boolean(stats?.hiddenSubscriberCount) };
}

async function githubReleases(repo: string): Promise<ReleaseEntry[]> {
  const response = await fetch(`${GITHUB_API}/repos/${repo}/releases?per_page=10`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "capital-command" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`GitHub releases answered HTTP ${response.status}`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as ReleaseEntry[]) : [];
}

export type LiveFactDeps = {
  streams: () => Promise<Array<{ title: string; ingestedAt: string; outcome?: string }>>;
  runs: () => Promise<StreamRun[]>;
  subscribers: () => Promise<{ subscribers: number | null; hidden: boolean }>;
  videos: () => Promise<Array<{ title: string; publishedAt: string; visibility: string | null; views: number | null; format: string }>>;
  releases: () => Promise<ReleaseEntry[]>;
  colateralLog: () => Promise<string>;
  arcadeLog: () => Promise<string>;
  readSnapshot: () => Promise<LiveFactsSnapshot | null>;
  writeSnapshot: (snapshot: LiveFactsSnapshot) => Promise<void>;
};

export function defaultLiveFactDeps(): LiveFactDeps {
  const colateral = repoPath("X_DRAFTS_COLATERAL_REPO", ["GitOrigin", "CoLateral-AI.git"]);
  const arcade = repoPath("X_DRAFTS_ARCADE_REPO", ["colateral-arcade"]);
  const releases = env("X_DRAFTS_RELEASES_REPO") || "nic21vdw/colateral-releases";
  return {
    streams: async () => (await readLedger()).records.filter((record) => record.outcome === "ready"),
    runs: async () => {
      const raw = await readJson<unknown>(dataPath("pipeline", "runs.json"));
      const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && "runs" in raw ? (raw as { runs: unknown }).runs : [];
      return (Array.isArray(list) ? list : Object.values(list ?? {})) as StreamRun[];
    },
    subscribers: subscriberCount,
    videos: async () =>
      rowsFromStore(await readMetrics())
        .filter((row) => row.platform === "youtube")
        .map((row) => ({ title: row.title, publishedAt: row.publishedAt, visibility: row.visibility, views: row.metrics.views ?? null, format: row.format })),
    releases: () => (releases.toLowerCase() === "off" ? Promise.resolve([]) : githubReleases(releases)),
    colateralLog: () => (colateral ? mainLog(colateral) : Promise.resolve("")),
    arcadeLog: () => (arcade ? mainLog(arcade) : Promise.resolve("")),
    readSnapshot: () => readJson<LiveFactsSnapshot>(dataPath(LIVE_FACTS_FILE)).catch(() => null),
    writeSnapshot: (snapshot) => atomicWriteJson(dataPath(LIVE_FACTS_FILE), snapshot)
  };
}

export function subscriberGoal(): number {
  const value = Number(env("X_DRAFTS_SUB_GOAL"));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 3000;
}

async function attempt(build: () => Promise<DatedFact[]>, at: string): Promise<SourceSnapshot> {
  try {
    return { at, ok: true, facts: await build() };
  } catch (error) {
    return { at, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200), facts: [] };
  }
}

export async function collectLiveFacts(options: { now: Date; today: string; timeZone: string; deps?: LiveFactDeps }): Promise<{ facts: DatedFact[]; snapshot: LiveFactsSnapshot }> {
  const deps = options.deps ?? defaultLiveFactDeps();
  const { today } = options;
  const at = options.now.toISOString();
  const toDate = (iso: string) => localCalendarParts(iso, options.timeZone).dateKey;
  const builders: Record<LiveSource, () => Promise<DatedFact[]>> = {
    stream: async () => streamFacts(await deps.streams(), toDate, today),
    streamNotes: async () => streamNoteFacts(await deps.runs(), toDate, today),
    channel: async () => subscriberFacts({ ...(await deps.subscribers()), goal: subscriberGoal(), date: today }),
    videos: async () => videoFacts(await deps.videos(), toDate, today),
    releases: async () => releaseFacts(await deps.releases(), toDate, today),
    colateral: async () => commitFacts(await deps.colateralLog(), "colateral", today),
    arcade: async () => commitFacts(await deps.arcadeLog(), "arcade", today)
  };
  const entries = await Promise.all(Object.entries(builders).map(async ([source, build]) => [source, await attempt(build, at)] as const));
  const snapshot = mergeSnapshot(await deps.readSnapshot(), Object.fromEntries(entries), at);
  await deps.writeSnapshot(snapshot).catch(() => undefined);
  return { facts: liveFactsFrom(snapshot), snapshot };
}

export async function readLiveFactsSnapshot(): Promise<LiveFactsSnapshot | null> {
  return readJson<LiveFactsSnapshot>(dataPath(LIVE_FACTS_FILE)).catch(() => null);
}
