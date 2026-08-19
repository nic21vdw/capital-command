"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReleaseStatus, ReleaseWatch } from "@/lib/release/shared";
import { watchRelease } from "@/lib/release/shared";

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
  const wentDown = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/update", { cache: "no-store" });
      if (!response.ok) return null;
      const next = (await response.json()) as ReleaseStatusWithProgress;
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
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

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
    const timer = setInterval(async () => {
      const next = await load();
      if (!next) {
        wentDown.current = true;
        return;
      }
      // The release script can die without ever stopping the server — a git
      // refusal, a failed npm install. Nothing goes down, nothing reloads, and
      // the banner spins forever. Its log is the only witness, so a logged
      // ERROR ends the wait here instead.
      if (next.progress?.failed) {
        setError(next.progress.failed);
        setPhase("idle");
        return;
      }
      if (next.progress?.finished || (wentDown.current && !next.pending.length)) {
        window.location.reload();
      }
    }, RESTART_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, load]);

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
    wentDown.current = false;
    try {
      const response = await fetch("/api/update", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not start the update.");
        setPhase("idle");
        return;
      }
      setPhase("updating");
    } catch {
      // The release can kill the server before the response comes back, which
      // is a successful start, not a failure.
      setPhase("updating");
    }
  }, []);

  const busy = phase === "starting" || phase === "updating";
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
      {children}
    </ReleaseContext.Provider>
  );
}

export function useRelease(): ReleaseContextValue {
  const value = useContext(ReleaseContext);
  if (!value) throw new Error("useRelease must be used inside a ReleaseProvider");
  return value;
}
