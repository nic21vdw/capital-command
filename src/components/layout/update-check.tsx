"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useRelease, type ReleaseStatusWithProgress } from "@/components/layout/release-provider";
import { updateCheckState } from "@/lib/release/shared";
import { cn } from "@/lib/utils";

const FLASH_MS = 5000;

type Look = {
  icon: typeof RefreshCw;
  label: string;
  detail: string;
  spin?: boolean;
  accent?: boolean;
  good?: boolean;
};

/**
 * "Check for updates", where Nic looks for it: the bottom of the sidebar, next
 * to Settings.
 *
 * The banner already announces a release when the app happens to notice one,
 * but noticing is a background poll — asking is a different act, and a button
 * that only ever appears when there is news cannot answer "am I on the latest?"
 * on demand. This one is always there, says which of the two answers it has,
 * and opens the same one-click install when the answer is yes.
 */
export function UpdateCheckButton({ collapsed = false }: { collapsed?: boolean }) {
  const { status, phase, busy, error, check, install } = useRelease();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const pending = status?.pending ?? [];
  const count = pending.length;
  const state = updateCheckState(status, phase);
  const available = state === "available";

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // A popover pinned to the sidebar would otherwise sit over whatever Nic
  // clicks next, on every page, until he found his way back to it.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  const activate = async () => {
    if (busy) return;
    if (available) {
      setOpen((current) => !current);
      return;
    }
    setOpen(false);
    const next = await check();
    if (next?.releasable && next.pending.length) setOpen(true);
    else if (next) setFlash(true);
  };

  const look = describe(state, { count, status, flash });

  return (
    <div ref={container} className="relative">
      {open && available && !busy && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] shadow-xl">
          <div className="border-b border-[var(--border)] px-3 py-2.5">
            <p className="text-sm font-semibold text-white">
              {count} change{count === 1 ? "" : "s"} ready to install
            </p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              Running {status?.runningShort ?? "an unstamped build"} · latest{" "}
              {status?.latestShort ?? "unknown"}
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto px-3 py-2.5">
            {status && status.notes.length > 0 ? (
              <ul className="space-y-1.5">
                {status.notes.map((note) => (
                  <li key={note} className="flex gap-2 text-xs text-white/85">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-1 font-mono text-[11px] text-[var(--muted-foreground)]">
                {pending.map((commit) => (
                  <li key={commit.commit} className="truncate">
                    <span className="text-white/50">{commit.commit}</span> {commit.subject}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-[var(--border)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => void install()}
              className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
            >
              Install and restart
            </button>
            <p className="mt-2 text-[11px] leading-snug text-[var(--muted-foreground)]">
              Capital Command rebuilds and restarts itself. This page reloads when it comes back.
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => void activate()}
        disabled={busy}
        title={collapsed ? `${look.label} — ${look.detail}` : undefined}
        aria-label={collapsed ? look.label : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition",
          collapsed && "justify-center px-2 py-2",
          look.accent
            ? "border border-[var(--accent)]/40 bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] font-medium text-white hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
            : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white",
          busy && "cursor-default"
        )}
      >
        <span className="relative flex shrink-0">
          <look.icon
            className={cn(
              "h-4 w-4",
              look.spin && "animate-spin",
              look.accent && "text-[var(--accent)]",
              look.good && "text-emerald-400"
            )}
          />
          {collapsed && look.accent && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--accent)]" />
          )}
        </span>
        {!collapsed && (
          <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
            <span className="truncate">{look.label}</span>
            <span className="truncate text-[11px] text-[var(--muted-foreground)]">
              {error ?? look.detail}
            </span>
          </span>
        )}
      </button>
    </div>
  );
}

function describe(
  state: ReturnType<typeof updateCheckState>,
  {
    count,
    status,
    flash
  }: { count: number; status: ReleaseStatusWithProgress | null; flash: boolean }
): Look {
  switch (state) {
    case "updating":
      return {
        icon: Loader2,
        label: "Updating…",
        detail: "Rebuilding and restarting",
        spin: true,
        accent: true
      };
    case "checking":
      return { icon: Loader2, label: "Checking…", detail: "Asking GitHub what is new", spin: true };
    case "available":
      return {
        icon: ArrowDownToLine,
        label: "Update available",
        detail: `${count} change${count === 1 ? "" : "s"} waiting`,
        accent: true
      };
    // A sandbox worktree can neither release nor meaningfully compare itself
    // to one, so it says so rather than claiming the app is up to date.
    case "elsewhere":
      return {
        icon: RefreshCw,
        label: "Check for updates",
        detail: status?.error ?? "Not the copy that releases"
      };
    case "up-to-date":
      return {
        icon: CheckCircle2,
        label: "Up to date",
        detail: flash ? "You have the latest" : `Running ${status?.runningShort ?? "an unstamped build"}`,
        good: true
      };
    default:
      return { icon: RefreshCw, label: "Check for updates", detail: "See if anything new is ready" };
  }
}
