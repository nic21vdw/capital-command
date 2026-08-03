"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, Loader2, X } from "lucide-react";
import { shouldShowBanner, type ReleaseStatus } from "@/lib/release/shared";
import { cn } from "@/lib/utils";

type Status = ReleaseStatus & { updating?: boolean };

const POLL_MS = 15 * 60 * 1000;
const RESTART_POLL_MS = 4000;
const DISMISSED_KEY = "cc.update.dismissed";

/**
 * Tells Nic when the app on his screen is older than the work waiting on
 * `dev`, and releases it when he says so.
 *
 * Until this existed the only way to know was to read CHANGELOG.md and
 * double-click a .bat, which meant finished work sat unreleased for days
 * because nothing ever said it was there. The banner does not decide anything
 * — the release is still one deliberate click, and `update-app.ps1` is still
 * the thing that runs — it just stops the decision from depending on
 * remembering to go looking.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "updating">("idle");
  const [error, setError] = useState<string | null>(null);
  const wentDown = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/update", { cache: "no-store" });
      if (!response.ok) return null;
      const next = (await response.json()) as Status;
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setDismissed(window.localStorage.getItem(DISMISSED_KEY));
      } catch {
        // Non-critical preference read.
      }
    });
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

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
      if (wentDown.current && !next.pending.length) window.location.reload();
    }, RESTART_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, load]);

  const update = async () => {
    setError(null);
    setPhase("starting");
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
  };

  const dismiss = () => {
    if (!status?.latest) return;
    setDismissed(status.latest);
    try {
      window.localStorage.setItem(DISMISSED_KEY, status.latest);
    } catch {
      // Non-critical preference persistence.
    }
  };

  const busy = phase !== "idle";
  if (!status || !shouldShowBanner(status, { dismissed, busy })) return null;

  const count = status.pending.length;

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_12%,var(--panel))]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/20 text-[var(--accent)]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            {busy
              ? "Updating Capital Command…"
              : `An update is ready — ${count} change${count === 1 ? "" : "s"} waiting`}
          </p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {busy
              ? "Rebuilding and restarting. This page reloads itself when it comes back — it can take a few minutes."
              : `Running ${status.runningShort ?? "an unstamped build"} · latest ${status.latestShort ?? "unknown"}`}
          </p>
        </div>

        {!busy && (
          <>
            {(status.notes.length > 0 || count > 0) && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
              >
                What&apos;s new
                <ChevronDown className={cn("h-3.5 w-3.5 transition", expanded && "rotate-180")} />
              </button>
            )}
            <button
              type="button"
              onClick={update}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
            >
              Update now
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss until the next update"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {error && <p className="px-4 pb-3 text-xs text-rose-300">{error}</p>}

      {expanded && !busy && (
        <div className="space-y-3 border-t border-[var(--border)] px-4 py-3">
          {status.notes.length > 0 ? (
            <ul className="space-y-1.5">
              {status.notes.map((note) => (
                <li key={note} className="flex gap-2 text-sm text-white/85">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted-foreground)]">
              Nothing was written under Unreleased in the changelog for these commits.
            </p>
          )}
          <details className="text-xs text-[var(--muted-foreground)]">
            <summary className="cursor-pointer select-none">
              {count} commit{count === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1.5 space-y-1 font-mono">
              {status.pending.map((commit) => (
                <li key={commit.commit} className="truncate">
                  <span className="text-white/50">{commit.commit}</span> {commit.subject}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
