"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReleaseStatus, ReleaseWatch } from "@/lib/release/shared";
import { watchRelease } from "@/lib/release/shared";
import { fetchRelease, restartOutcome, type RestartStatus } from "@/lib/release/restart";

export type ReleasePhase = "idle" | "checking" | "starting" | "updating";

export type ReleaseProgress = {
  step: string | null;
  failed: string | null;
  finished: boolean;
  startedAt: number | null;
  quietFor: number | null;
  tail: string[];
};

export type ReleaseStatusWithProgress = ReleaseStatus & {
  instance?: string;
  updating?: boolean;
  progress?: ReleaseProgress;
};

type ReleaseContextValue = {
  status: ReleaseStatusWithProgress | null;
  phase: ReleasePhase;
  busy: boolean;
  error: string | null;
  checkedAt: number | null;
  /** What the running release is doing, as something safe to put on screen. */
  watch: ReleaseWatch | null;
  check: () => Promise<ReleaseStatusWithProgress | null>;
  install: () => Promise<void>;
};

const ReleaseContext = createContext<ReleaseContextValue | null>(null);

const POLL_MS = 15 * 60 * 1000;
const RESTART_POLL_MS = 4000;
const TICK_MS = 1000;

/**
 * One release check for the whole shell.
 *
 * Both the banner and the sidebar's "Check for updates" button answer the same
 * question, and every answer costs a `git fetch` on Nic's machine. Two
 * components polling independently would also disagree on screen — the button
 * saying "up to date" while the banner still offers an update it fetched a
 * quarter of an hour ago. So the state lives here and they render it.
 */
export function ReleaseProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ReleaseStatusWithProgress | null>(null);
  const [phase, setPhase] = useState<ReleasePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const busy = phase === "starting" || phase === "updating";
  const previousInstance = useRef<string | null>(null);
  const checking = useRef(false);

  const load = useCallback(async () => {
    if (checking.current) return null;
    checking.current = true;
    try {
      const next = await fetchRelease<ReleaseStatusWithProgress>("/api/update", {}, 60_000);
      previousInstance.current ??= next.instance ?? null;
      setStatus(next);
      setCheckedAt(Date.now());
      setOffline(false);
      if (next.progress?.startedAt) setStartedAt(next.progress.startedAt);
      // A release survives the page that started it: the server restarts, and
      // so does anything opened, reloaded or opened in a second tab while it
      // runs. Without adopting what the app itself reports, those screens show
      // no update at all and then reload under him with no explanation.
      if (next.updating) {
        setPhase((current) => (current === "updating" ? current : "updating"));
      }
      return next;
    } catch {
      setOffline(true);
      return null;
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    if (busy) return;
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, busy]);

  // The clock is the only thing that can still move while the server is down,
  // and it is the whole difference between "this is working" and a spinner that
  // has said the same thing for twenty minutes.
  useEffect(() => {
    if (phase !== "updating" && phase !== "starting") return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  // While a release runs the server is stopped, rebuilt and started again, so
  // polling is expected to FAIL for a while and then succeed. Waiting for it
  // to go down first is what stops the first poll — answered by the old server
  // still shutting down — from reading as "done, nothing changed".
  useEffect(() => {
    if (phase !== "updating") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await fetchRelease<RestartStatus>("/api/update/progress");
        if (cancelled) return;
        setOffline(false);
        setStatus((current) => current ? { ...current, progress: next.progress } : current);
        if (next.progress.startedAt) setStartedAt(next.progress.startedAt);
        const outcome = restartOutcome(previousInstance.current, next);
        previousInstance.current ??= next.instance;
        if (outcome === "reload") {
          // Reload only this frame. CoLateral keeps the card in its array slot.
          window.location.reload();
          return;
        }
        if (outcome === "failed" || outcome === "abandoned") {
          setError(next.progress.failed ?? "The update stopped reporting progress. You can retry the update.");
          setPhase("idle");
          return;
        }
      } catch {
        // The server is intentionally offline during the build.
        if (!cancelled) setOffline(true);
      }
      if (!cancelled) timer = setTimeout(() => void poll(), RESTART_POLL_MS);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phase]);

  const check = useCallback(async () => {
    setError(null);
    setPhase((current) => (current === "idle" ? "checking" : current));
    const next = await load();
    setPhase((current) => (current === "checking" ? "idle" : current));
    if (!next) setError("Could not check for updates — the app did not answer.");
    return next;
  }, [load]);

  const install = useCallback(async () => {
    setError(null);
    setPhase("starting");
    setStartedAt(Date.now());
    previousInstance.current = status?.instance ?? previousInstance.current;
    try {
      const response = await fetch("/api/update", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not start the update.");
        setPhase("idle");
        return;
      }
      const result = await response.json() as { instance?: string };
      previousInstance.current = result.instance ?? previousInstance.current;
      setPhase("updating");
    } catch {
      // The release can kill the server before the response comes back, which
      // is a successful start, not a failure.
      setPhase("updating");
    }
  }, [status?.instance]);

  const watch = busy
    ? watchRelease({
        step: status?.progress?.step ?? null,
        failed: status?.progress?.failed ?? null,
        startedAt,
        offline,
        now
      })
    : null;

  return (
    <ReleaseContext.Provider
      value={{ status, phase, busy, error, checkedAt, watch, check, install }}
    >
      {busy ? (
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
          <section role="status" className="w-full max-w-lg space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
            <h1 className="text-lg font-semibold">Updating Capital Command</h1>
            <p className="text-sm">{watch?.headline}</p>
            <p className="text-sm text-[var(--muted-foreground)]">{watch?.detail}</p>
          </section>
        </main>
      ) : children}
    </ReleaseContext.Provider>
  );
}

export function useRelease(): ReleaseContextValue {
  const value = useContext(ReleaseContext);
  if (!value) throw new Error("useRelease must be used inside a ReleaseProvider");
  return value;
}
