"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, ChevronDown, Loader2, X } from "lucide-react";
import { useRelease } from "@/components/layout/release-provider";
import { shouldShowBanner } from "@/lib/release/shared";
import { cn } from "@/lib/utils";

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
  const { status, busy, error, install } = useRelease();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setDismissed(window.localStorage.getItem(DISMISSED_KEY));
      } catch {
        // Non-critical preference read.
      }
    });
  }, []);

  const dismiss = () => {
    if (!status?.latest) return;
    setDismissed(status.latest);
    try {
      window.localStorage.setItem(DISMISSED_KEY, status.latest);
    } catch {
      // Non-critical preference persistence.
    }
  };

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
              onClick={() => void install()}
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
