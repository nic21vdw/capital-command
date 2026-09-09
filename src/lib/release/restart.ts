import type { ReleaseProgress } from "@/lib/release/progress";

export type RestartStatus = {
  instance: string;
  running: string | null;
  updating: boolean;
  progress: ReleaseProgress;
};

export function restartOutcome(previous: string | null, next: RestartStatus) {
  // A new process is sufficient even when more commits landed during the build,
  // or the release missed its final log line. A network hiccup is not a restart.
  if (previous && next.instance !== previous) return "reload";
  if (next.progress.failed) return "failed";
  if (next.progress.finished) return "reload";
  if (!next.updating && next.progress.quietFor !== null && next.progress.quietFor > 900) return "abandoned";
  return "waiting";
}

export async function fetchRelease<T>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Update check returned HTTP ${response.status}.`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}
