"use client";

import Link from "next/link";
import { Radio } from "lucide-react";
import { useStream } from "@/components/providers/stream-provider";
import { streamProgressLabel } from "@/lib/pipeline/streams";
import { cn } from "@/lib/utils";

/**
 * "Working on …" — the top of the sidebar, above the numbered flow.
 *
 * Every screen below it is a view of ONE recording, and until this existed
 * nothing on screen said which one. It names the stream, says how far along it
 * is, and lets you switch — and because the nav links read the same selection,
 * switching here re-points the whole flow at the other recording.
 */
export function StreamCard({ collapsed = false }: { collapsed?: boolean }) {
  const { streams, stream, loaded, select } = useStream();

  if (loaded && streams.length === 0) return null;

  if (collapsed) {
    return (
      <div className="flex justify-center pb-2" title={stream ? `Working on ${stream.name}` : "No stream picked"}>
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg border",
            stream
              ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--muted-foreground)]"
          )}
        >
          <Radio className="h-4 w-4" />
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
        Working on
      </p>
      {/* The picker IS the name — showing it twice only cost sidebar height
          the numbered flow needed more. */}
      <label className="sr-only" htmlFor="stream-picker">
        Stream to work on
      </label>
      <select
        id="stream-picker"
        value={stream?.id ?? ""}
        onChange={(event) => select(event.target.value || null)}
        title={stream?.name}
        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs text-white"
      >
        <option value="">Every stream</option>
        {streams.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      {stream && (
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[11px]",
              stream.needsAttention ? "text-amber-300" : "text-[var(--muted-foreground)]"
            )}
          >
            {streamProgressLabel(stream)}
          </span>
          <Link
            href={`/?run=${encodeURIComponent(stream.id)}`}
            className="shrink-0 text-[11px] text-[var(--muted-foreground)] hover:text-white"
          >
            Open
          </Link>
        </div>
      )}
    </div>
  );
}
