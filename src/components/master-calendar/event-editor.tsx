"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Ban, Loader2, Lock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CALENDAR_SOURCE_BY_ID } from "@/lib/master-calendar/types";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";

const NUDGES = [
  { label: "−1 hr", minutes: -60 },
  { label: "−15 m", minutes: -15 },
  { label: "+15 m", minutes: 15 },
  { label: "+1 hr", minutes: 60 }
];

export function EventEditor({
  event,
  timeZone,
  busy,
  onClose,
  onNudge,
  onRewrite,
  onSkip
}: {
  event: MasterCalendarEvent;
  timeZone: string;
  busy: boolean;
  onClose: () => void;
  onNudge: (minutes: number) => Promise<boolean>;
  onRewrite: (text: string) => Promise<boolean>;
  onSkip: () => Promise<boolean>;
}) {
  const source = CALENDAR_SOURCE_BY_ID[event.source];
  const target = event.edit;
  const locked = target?.lockedReason;
  const [text, setText] = useState(target?.text ?? "");

  const when = target
    ? new Date(target.publishAt).toLocaleString("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : null;

  return (
    <Modal open title={event.title} description={`${source.shortLabel} · ${event.platforms.join(", ")}`} onClose={onClose}>
      <div className="space-y-4">
        {locked ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {locked}
          </p>
        ) : null}

        {!target ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            This one is managed in {source.hrefLabel} — the calendar shows it but can&apos;t change it here.
          </p>
        ) : (
          <>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">Goes out</span>
                <span className="text-sm font-semibold text-white">{when}</span>
              </div>
              {!locked ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {NUDGES.map((nudge) => (
                    <button
                      key={nudge.label}
                      type="button"
                      disabled={busy}
                      onClick={() => void onNudge(nudge.minutes)}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white disabled:opacity-50"
                    >
                      {nudge.label}
                    </button>
                  ))}
                  <span className="self-center text-[11px] text-[var(--muted-foreground)]">
                    or drag it to another day
                  </span>
                </div>
              ) : null}
            </div>

            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">
                {target.kind === "threads" ? "Post" : "Caption"}
              </span>
              <textarea
                value={text}
                disabled={Boolean(locked)}
                onChange={(changed) => setText(changed.target.value)}
                rows={4}
                className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
            </label>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
          <Link
            href={source.href}
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition hover:text-white"
          >
            Open in {source.hrefLabel}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
          <div className="flex items-center gap-2">
            {target && !locked ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSkip().then((ok) => ok && onClose())}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Skip
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:text-white"
            >
              Close
            </button>
            {target && !locked ? (
              <button
                type="button"
                disabled={busy || text === target.text}
                onClick={() => void onRewrite(text)}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save copy
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
