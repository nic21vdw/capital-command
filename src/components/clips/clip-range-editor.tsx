"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Magnet, Play, RotateCcw, Scissors, ZoomIn, ZoomOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CONTEXT_PADDINGS,
  MAX_RECUT_SEC,
  MIN_RECUT_SEC,
  clampRange,
  contextWindow,
  formatTimecode,
  parseTimecode,
  rangesWithin,
  rulerTicks,
  snapToSpeech,
  spokenAround,
  type TimeRange
} from "@/lib/clipping/timeline";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { CaptionSegment } from "@/types/domain";

const NUDGES = [-5, -1, 1, 5];

/**
 * Moves a clip's in/out points around inside the stream it came from. The
 * suggested cut is one reading of a moment — the transcript either side of it
 * is right there so the sentence that runs past the out point can be pulled in,
 * and the waveform (uploads, which still have their source on disk) shows where
 * the talking actually stops.
 *
 * Everything here is in ABSOLUTE source seconds. Applying re-cuts the clip
 * server-side, which rewrites its master, preview and ready-to-post renders.
 */
export function ClipRangeEditor({
  job,
  clip,
  index,
  captions,
  captionsLoading,
  onApply,
  busy
}: {
  job: ClipJob;
  clip: ClipCandidate;
  index: number;
  captions: CaptionSegment[];
  captionsLoading: boolean;
  onApply: (range: TimeRange) => void;
  busy: boolean;
}) {
  // Seeded from the clip's current range. The caller keys this panel on that
  // range, so a finished re-cut remounts it around the new cut rather than
  // leaving the draft describing footage that no longer exists.
  const durationSec = job.durationSec ?? clip.end;
  const [draft, setDraft] = useState<TimeRange>({ start: clip.start, end: clip.end });
  const [paddingIndex, setPaddingIndex] = useState(1);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  const padding = CONTEXT_PADDINGS[paddingIndex];
  const view = useMemo(
    () => contextWindow(draft, { durationSec, paddingSec: padding }),
    [draft, durationSec, padding]
  );
  const span = Math.max(0.001, view.end - view.start);
  const pct = useCallback((seconds: number) => ((seconds - view.start) / span) * 100, [span, view.start]);

  const set = useCallback(
    (next: TimeRange, anchor: "start" | "end") =>
      setDraft(clampRange(next, { durationSec, anchor })),
    [durationSec]
  );

  const silences = useMemo(
    () => rangesWithin(job.silences ?? [], view.start, view.end),
    [job.silences, view.end, view.start]
  );
  const words = useMemo(() => spokenAround(captions, draft, view), [captions, draft, view]);
  const ticks = useMemo(() => rulerTicks(view.start, view.end, undefined), [view.end, view.start]);

  // Uploaded sources keep the whole recording on disk, so they get a real
  // waveform and a scrubbable source player. A URL job only kept its audio for
  // analysis, so there the transcript is the guide.
  const sourceId = job.sourceId;
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    void fetch(`/api/clips/sources/${sourceId}/waveform`, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : { peaks: [] }))
      .then((data: { peaks?: number[] }) => {
        if (!cancelled) setPeaks(data.peaks ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const secondsAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return view.start;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return view.start + ratio * span;
    },
    [span, view.start]
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const seconds = secondsAt(event.clientX);
      if (dragging === "start") set({ start: seconds, end: draft.end }, "end");
      else set({ start: draft.start, end: seconds }, "start");
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, draft.end, draft.start, secondsAt, set]);

  const playRange = () => {
    const video = videoRef.current;
    if (!video) return;
    stopAtRef.current = draft.end;
    video.currentTime = draft.start;
    void video.play().catch(() => undefined);
  };

  const snapBoth = () => {
    const start = snapToSpeech(draft.start, captions, "start");
    const end = snapToSpeech(draft.end, captions, "end");
    set({ start: start ?? draft.start, end: end ?? draft.end }, "start");
  };

  const suggested = clip.originalRange ?? { start: clip.start, end: clip.end };
  const length = draft.end - draft.start;
  const changed = draft.start !== clip.start || draft.end !== clip.end;
  const atSuggested = draft.start === suggested.start && draft.end === suggested.end;

  return (
    <div className="space-y-3 border-t border-white/10 bg-[var(--well-deep)]/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <TimeField
            label="In"
            seconds={draft.start}
            onCommit={(seconds) => set({ start: seconds, end: draft.end }, "end")}
          />
          <TimeField
            label="Out"
            seconds={draft.end}
            onCommit={(seconds) => set({ start: draft.start, end: seconds }, "start")}
          />
          <Badge className={cn(changed && "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]")}>
            {length.toFixed(1)}s
            {changed ? ` (was ${Math.round(clip.end - clip.start)}s)` : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label="Show less of the stream"
            disabled={paddingIndex === 0}
            onClick={() => setPaddingIndex((value) => Math.max(0, value - 1))}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </IconButton>
          <span className="w-16 text-center text-[11px] tabular-nums text-[var(--muted-foreground)]">
            ±{formatTimecode(padding)}
          </span>
          <IconButton
            label="Show more of the stream"
            disabled={paddingIndex === CONTEXT_PADDINGS.length - 1}
            onClick={() => setPaddingIndex((value) => Math.min(CONTEXT_PADDINGS.length - 1, value + 1))}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {sourceId && (
        <div className="flex gap-3">
          <video
            ref={videoRef}
            src={`/api/clips/sources/${sourceId}/stream`}
            preload="metadata"
            playsInline
            controls
            onTimeUpdate={(event) => {
              const stopAt = stopAtRef.current;
              if (stopAt !== null && event.currentTarget.currentTime >= stopAt) {
                event.currentTarget.pause();
                stopAtRef.current = null;
              }
            }}
            className="aspect-video w-full max-w-[280px] rounded-md bg-black"
          />
          <div className="flex flex-col gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={playRange}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Play the range
            </Button>
            <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
              Scrubbing the full recording. Playback stops at the out point.
            </p>
          </div>
        </div>
      )}

      <div
        ref={trackRef}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          // Clicking the empty track moves the nearer edge to it — the fastest
          // way to stretch a clip out to a moment you can see on the waveform.
          const seconds = secondsAt(event.clientX);
          const edge =
            Math.abs(seconds - draft.start) <= Math.abs(seconds - draft.end) ? "start" : "end";
          if (edge === "start") set({ start: seconds, end: draft.end }, "end");
          else set({ start: draft.start, end: seconds }, "start");
        }}
        className="relative h-24 w-full cursor-pointer touch-none select-none overflow-hidden rounded-md border border-white/10 bg-black/40"
      >
        {peaks && peaks.length > 0 && (
          <Waveform peaks={peaks} durationSec={durationSec} view={view} />
        )}

        {silences.map((silence) => (
          <div
            key={`silence-${silence.start}`}
            className="pointer-events-none absolute inset-y-0 bg-white/[0.06]"
            style={{ left: `${pct(silence.start)}%`, width: `${((silence.end - silence.start) / span) * 100}%` }}
            aria-hidden
          />
        ))}

        <div
          className="pointer-events-none absolute inset-y-0 border-x-2 border-[var(--accent)] bg-[var(--accent)]/20"
          style={{ left: `${pct(draft.start)}%`, width: `${(length / span) * 100}%` }}
        />

        <Handle
          edge="start"
          left={pct(draft.start)}
          seconds={draft.start}
          onPointerDown={() => setDragging("start")}
          onNudge={(delta) => set({ start: draft.start + delta, end: draft.end }, "end")}
        />
        <Handle
          edge="end"
          left={pct(draft.end)}
          seconds={draft.end}
          onPointerDown={() => setDragging("end")}
          onNudge={(delta) => set({ start: draft.start, end: draft.end + delta }, "start")}
        />

        {ticks.map((tick) => (
          <span
            key={tick}
            className={cn(
              "pointer-events-none absolute bottom-0.5 text-[10px] tabular-nums text-white/40",
              // Pull the labels at either end inward so neither is sliced off.
              pct(tick) < 4 ? "translate-x-0" : pct(tick) > 96 ? "-translate-x-full" : "-translate-x-1/2"
            )}
            style={{ left: `${pct(tick)}%` }}
          >
            {formatTimecode(tick)}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <NudgeGroup
          label="In"
          onNudge={(delta) => set({ start: draft.start + delta, end: draft.end }, "end")}
        />
        <NudgeGroup
          label="Out"
          onNudge={(delta) => set({ start: draft.start, end: draft.end + delta }, "start")}
        />
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          onClick={snapBoth}
          disabled={captions.length === 0}
          title="Move both edges onto the nearest word boundary"
        >
          <Magnet className="mr-1.5 h-3.5 w-3.5" />
          Snap to speech
        </Button>
      </div>

      <div className="rounded-md border border-white/10 bg-black/20 p-3">
        {captionsLoading ? (
          <p className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading the transcript around this moment...
          </p>
        ) : words.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            No transcript for this stretch of the stream — use the waveform and the timecodes instead.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
              Click a word to start the clip there, shift-click to end it there. Dimmed words fall outside the cut.
            </p>
            <p className="max-h-32 overflow-y-auto text-sm leading-6">
              {words.map((word, wordIndex) => (
                <button
                  key={`${word.start}-${wordIndex}`}
                  type="button"
                  onClick={(event) => {
                    if (event.shiftKey) set({ start: draft.start, end: word.end }, "start");
                    else set({ start: word.start, end: draft.end }, "end");
                  }}
                  className={cn(
                    "rounded px-0.5 transition hover:bg-[var(--accent)]/25",
                    word.inside ? "text-white" : "text-white/35"
                  )}
                >
                  {word.text}
                </button>
              ))}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {formatTimecode(draft.start)} - {formatTimecode(draft.end)} of {formatTimecode(durationSec)} · clips run{" "}
          {MIN_RECUT_SEC}s to {Math.round(MAX_RECUT_SEC / 60)} min
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            disabled={atSuggested}
            onClick={() => setDraft(suggested)}
            title={
              clip.originalRange
                ? "Go back to the range the generator suggested"
                : "This clip is still on its suggested range"
            }
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Suggested range
          </Button>
          <Button className="px-3 py-1.5 text-xs" disabled={!changed || busy} onClick={() => onApply(draft)}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Scissors className="mr-1.5 h-3.5 w-3.5" />
            )}
            Re-cut clip {index + 1}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The waveform of the visible slice of the stream. Peaks cover the whole
 * source at a fixed resolution, so the window is a slice of that array rather
 * than a fresh fetch.
 */
function Waveform({
  peaks,
  durationSec,
  view
}: {
  peaks: number[];
  durationSec: number;
  view: TimeRange;
}) {
  const bars = useMemo(() => {
    const first = Math.floor((view.start / durationSec) * peaks.length);
    const last = Math.ceil((view.end / durationSec) * peaks.length);
    const slice = peaks.slice(Math.max(0, first), Math.min(peaks.length, Math.max(first + 1, last)));
    const target = 240;
    let sampled = slice;
    if (slice.length > target) {
      // Downsample by peak, not by average — a quiet average hides the one loud
      // moment that tells you where the talking is.
      const bucket = slice.length / target;
      sampled = Array.from({ length: target }, (_, i) =>
        Math.max(
          ...slice.slice(Math.floor(i * bucket), Math.max(Math.floor(i * bucket) + 1, Math.floor((i + 1) * bucket)))
        )
      );
    }
    // Scaled to the loudest thing on screen rather than to full scale: a
    // quietly-recorded stream still has to show WHERE the talking is, which is
    // the only thing this is for.
    const loudest = Math.max(0.02, ...sampled);
    return sampled.map((peak) => peak / loudest);
  }, [durationSec, peaks, view.end, view.start]);

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center gap-px px-px" aria-hidden>
      {bars.map((peak, i) => (
        <span key={i} className="flex-1 rounded-sm bg-white/25" style={{ height: `${Math.max(2, peak * 78)}%` }} />
      ))}
    </div>
  );
}

function Handle({
  edge,
  left,
  seconds,
  onPointerDown,
  onNudge
}: {
  edge: "start" | "end";
  left: number;
  seconds: number;
  onPointerDown: () => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <button
      type="button"
      role="slider"
      aria-label={edge === "start" ? "Clip in point" : "Clip out point"}
      aria-valuetext={formatTimecode(seconds)}
      aria-valuenow={Math.round(seconds)}
      onPointerDown={(event) => {
        event.preventDefault();
        onPointerDown();
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 1 : 0.1;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onNudge(-step);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onNudge(step);
        }
      }}
      className={cn(
        "absolute inset-y-0 z-10 w-3 cursor-ew-resize touch-none bg-[var(--accent)] transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-white",
        edge === "start" ? "-translate-x-full rounded-l-sm" : "rounded-r-sm"
      )}
      style={{ left: `${left}%` }}
    />
  );
}

function NudgeGroup({ label, onNudge }: { label: string; onNudge: (delta: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-6 text-xs text-[var(--muted-foreground)]">{label}</span>
      {NUDGES.map((delta) => (
        <button
          key={delta}
          type="button"
          onClick={() => onNudge(delta)}
          className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
        >
          {delta > 0 ? `+${delta}` : delta}s
        </button>
      ))}
    </div>
  );
}

function TimeField({
  label,
  seconds,
  onCommit
}: {
  label: string;
  seconds: number;
  onCommit: (seconds: number) => void;
}) {
  // `null` means "show whatever the range currently is" — so dragging a handle
  // updates the field, and typing in it takes over until focus leaves. No
  // syncing, and no way for the two to disagree.
  const [typed, setTyped] = useState<string | null>(null);

  const commit = () => {
    const parsed = typed === null ? null : parseTimecode(typed);
    setTyped(null);
    if (parsed !== null) onCommit(parsed);
  };

  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
      {label}
      <input
        value={typed ?? formatTimecode(seconds)}
        aria-label={`${label} point`}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="w-20 rounded-md border border-[var(--border)] bg-[var(--well-deep)] px-2 py-1 text-center text-xs tabular-nums text-white outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}
