"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatTimecode, packLanes, rulerTicks } from "@/lib/clipping/timeline";
import type { ClipCandidate } from "@/lib/clipping/types";

/**
 * The whole stream as one bar, with every suggested clip marked where it was
 * actually taken from. Clips are minutes-long needles in an hours-long
 * haystack, so this is the only view that answers "where in the stream is
 * this?" — and clicking a band jumps to that clip's card.
 */
export function StreamMap({
  durationSec,
  clips,
  selectedClipId,
  onSelect
}: {
  durationSec: number;
  clips: ClipCandidate[];
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
}) {
  // A 20-second clip is a hairline on a 3-hour bar. Pack lanes against the
  // width a band is actually DRAWN at, so two clips a minute apart get their
  // own rows instead of overlapping into an unreadable smear.
  const minSpanSec = durationSec * 0.02;
  const lanes = useMemo(() => packLanes(clips, minSpanSec), [clips, minSpanSec]);
  const laneCount = Math.max(1, Math.max(...lanes, 0) + 1);
  const ticks = useMemo(() => rulerTicks(0, durationSec, undefined), [durationSec]);
  const clippedSec = clips.reduce((total, clip) => total + (clip.end - clip.start), 0);
  const pct = (seconds: number) => `${(seconds / durationSec) * 100}%`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-white">Where these clips come from</h3>
        <p className="text-xs text-[var(--muted-foreground)]">
          {clips.length} clip{clips.length === 1 ? "" : "s"} · {formatTimecode(clippedSec)} of{" "}
          {formatTimecode(durationSec)} ({Math.round((clippedSec / durationSec) * 100)}%)
        </p>
      </div>

      <div
        className="relative w-full rounded-lg border border-white/10 bg-[var(--well-deep)] px-2 pb-1 pt-2"
        style={{ height: `${laneCount * 16 + 26}px` }}
      >
        <div className="relative h-full w-full">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute bottom-4 top-0 w-px bg-white/10"
              style={{ left: pct(tick) }}
              aria-hidden
            />
          ))}

          {clips.map((clip, index) => {
            const selected = clip.id === selectedClipId;
            return (
              <button
                key={clip.id}
                type="button"
                onClick={() => onSelect(clip.id)}
                title={`Clip ${index + 1} · ${formatTimecode(clip.start)} - ${formatTimecode(clip.end)}`}
                aria-label={`Clip ${index + 1}, ${formatTimecode(clip.start)} to ${formatTimecode(clip.end)}`}
                className={cn(
                  "absolute h-3 min-w-[8px] rounded-sm border transition",
                  selected
                    ? "z-10 border-white bg-white shadow-[0_0_0_2px_rgba(255,255,255,0.25)]"
                    : "border-[var(--accent)]/50 bg-[var(--accent)]/70 hover:bg-[var(--accent)]"
                )}
                style={{
                  left: pct(clip.start),
                  width: pct(Math.max(clip.end - clip.start, durationSec * 0.002)),
                  top: `${lanes[index] * 16}px`
                }}
              />
            );
          })}

          {ticks.map((tick) => (
            <span
              key={`label-${tick}`}
              className={cn(
                "absolute bottom-0 text-[10px] tabular-nums text-[var(--muted-foreground)]",
                // Nudge the labels at either end inward so neither is sliced
                // in half by the edge of the bar.
                tick / durationSec < 0.04
                  ? "translate-x-0"
                  : tick / durationSec > 0.96
                    ? "-translate-x-full"
                    : "-translate-x-1/2"
              )}
              style={{ left: pct(tick) }}
            >
              {formatTimecode(tick)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
