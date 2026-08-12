"use client";

import { Film, Loader2, RotateCcw, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { AdvancedOptions } from "@/components/ui/advanced-options";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { autoAssignableCount } from "@/components/uploading-center/bulk";
import { ClipCard, SUGGESTED_HASHTAGS } from "@/components/uploading-center/clip-card";
import type { RunDefaults } from "@/components/uploading-center/run-defaults";
import {
  PLATFORM_TARGET_LABELS,
  type ClipDraft,
  type PlatformTarget,
  type ReadyClip
} from "@/components/uploading-center/use-uploading-center";
import type { ClipJob } from "@/lib/clipping/types";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { QueueItem } from "@/lib/publisher/types";
import { cn } from "@/lib/utils";

/**
 * The clips produced by the current run (newest job with rendered clips by
 * default; older runs are reachable from the picker). One button books the
 * whole run at the next free slots; the run's platform, hashtags and the
 * caption pass sit behind Customise, summarised so what they are set to is
 * readable without opening it. Each card can still be scheduled inline or
 * dragged onto the board.
 */
export function ClipQueue({
  jobs,
  activeJob,
  onSelectJob,
  clips,
  slots,
  draftFor,
  onDraftChange,
  onTitleCommit,
  isSlotTaken,
  itemsForClip,
  busy,
  highlightedKey,
  onSchedule,
  onEditClip,
  onTailorCaption,
  onAutoAssign,
  runDefaults,
  onRunDefaultsChange,
  onCaptionsForAll,
  captionsMissing,
  captionProgress,
  captionFailures,
  failedCaptionCount,
  onRetryCaptions
}: {
  jobs: ClipJob[];
  activeJob: ClipJob | null;
  onSelectJob: (jobId: string) => void;
  clips: ReadyClip[];
  slots: ScheduleSlot[];
  draftFor: (clip: ReadyClip) => ClipDraft;
  onDraftChange: (clip: ReadyClip, draft: ClipDraft) => void;
  onTitleCommit: (clip: ReadyClip) => void;
  isSlotTaken: (target: PlatformTarget, slotUtc: string) => boolean;
  itemsForClip: (clip: ReadyClip) => QueueItem[];
  busy: string | null;
  /** Clip currently being placed onto the board (arrived via Schedule Short). */
  highlightedKey?: string | null;
  onSchedule: (clip: ReadyClip) => void;
  /** Open the given clip in the Clip Editor. */
  onEditClip: (clip: ReadyClip) => void;
  /** Tailor the clip's caption to its selected platform with the free AI provider. */
  onTailorCaption: (clip: ReadyClip) => void;
  onAutoAssign: () => void;
  /** Platform + hashtags every new draft in this run starts with. */
  runDefaults: RunDefaults;
  onRunDefaultsChange: (defaults: RunDefaults) => void;
  /** Write a caption for every unscheduled clip that hasn't got one. */
  onCaptionsForAll: () => void;
  captionsMissing: number;
  captionProgress: { done: number; total: number } | null;
  /** Clip key → why its AI caption failed. Marks the card and drives the retry. */
  captionFailures: Record<string, string>;
  failedCaptionCount: number;
  /** Write the failed clips' captions again — nothing else is touched. */
  onRetryCaptions: () => void;
}) {
  const autoAssigning = busy === "auto-assign";
  const writingCaptions = busy === "captions-all";
  const bulkBusy = autoAssigning || writingCaptions;
  const toggleHashtag = (hashtag: string) => {
    const hashtags = runDefaults.hashtags.includes(hashtag)
      ? runDefaults.hashtags.filter((candidate) => candidate !== hashtag)
      : [...runDefaults.hashtags, hashtag];
    onRunDefaultsChange({ ...runDefaults, hashtags });
  };
  const unscheduled = clips.filter((clip) => itemsForClip(clip).length === 0).length;
  // What the click will really book — see `autoAssignableCount`. Counted with
  // the failures already known, so it agrees with the warning below it; a
  // caption that fails during the run itself cannot be foreseen here.
  const bookable = autoAssignableCount({
    clips,
    draftFor,
    isScheduled: (clip) => itemsForClip(clip).length > 0,
    slots,
    isTargetSlotTaken: isSlotTaken,
    skipKeys: new Set(Object.keys(captionFailures))
  });
  const shownHashtags = runDefaults.hashtags.slice(0, 3);
  const extraHashtags = runDefaults.hashtags.length - shownHashtags.length;
  const hashtagSummary =
    shownHashtags.length > 0
      ? `${shownHashtags.join(" ")}${extraHashtags > 0 ? ` +${extraHashtags}` : ""}`
      : "no hashtags";
  const captionSummary =
    captionsMissing > 0
      ? `AI writes ${captionsMissing} caption${captionsMissing === 1 ? "" : "s"}`
      : "all captioned";
  const optionsSummary = `${PLATFORM_TARGET_LABELS[runDefaults.platform]} · ${captionSummary} · ${hashtagSummary}`;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Clips in this run</h2>
        {jobs.length > 1 ? (
          <Select
            value={activeJob?.id ?? ""}
            onChange={(event) => onSelectJob(event.target.value)}
            className="h-9 w-auto max-w-56"
            aria-label="Clip run"
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.fileName}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {clips.length > 0 ? (
        <div className="space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
          {/* Disabled only when there is genuinely nothing left to book. When
              clips are unscheduled but none can be booked, the press is what
              explains why — a dead button would leave that unsaid. */}
          <Button className="h-11 w-full" onClick={onAutoAssign} disabled={bulkBusy || unscheduled === 0}>
            {autoAssigning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-4 w-4" />
            )}
            {unscheduled === 0
              ? "Every clip here is scheduled"
              : bookable > 0
                ? `Schedule ${bookable} clip${bookable === 1 ? "" : "s"} at the next free slots`
                : "Schedule at the next free slots"}
          </Button>
          <AdvancedOptions id="uploading-center-run" summary={optionsSummary}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                For this run
              </span>
              <Select
                value={runDefaults.platform}
                onChange={(event) =>
                  onRunDefaultsChange({ ...runDefaults, platform: event.target.value as PlatformTarget })
                }
                className="h-9 w-auto min-w-28"
                aria-label="Default platform for this run"
              >
                {(Object.keys(PLATFORM_TARGET_LABELS) as PlatformTarget[]).map((target) => (
                  <option key={target} value={target}>
                    {PLATFORM_TARGET_LABELS[target]}
                  </option>
                ))}
              </Select>
              <span className="flex-1" />
              <Button
                variant="secondary"
                className="h-9 px-3 text-xs"
                onClick={onCaptionsForAll}
                disabled={bulkBusy}
                title="Write an AI caption for every unscheduled clip in this run that hasn't got one"
              >
                {writingCaptions ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                {writingCaptions && captionProgress
                  ? `Writing ${captionProgress.done}/${captionProgress.total}…`
                  : `AI captions for all${captionsMissing > 0 ? ` (${captionsMissing})` : ""}`}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {SUGGESTED_HASHTAGS.map((hashtag) => {
                const on = runDefaults.hashtags.includes(hashtag);
                return (
                  <button
                    key={hashtag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleHashtag(hashtag)}
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] transition",
                      on
                        ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--muted-foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    )}
                  >
                    {hashtag}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Every clip in this run posts to {PLATFORM_TARGET_LABELS[runDefaults.platform]} with these hashtags on its
              title. Changing them here updates the cards below.
            </p>
          </AdvancedOptions>
          {failedCaptionCount > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-2.5 py-2">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span className="min-w-0 flex-1 text-[11px] text-amber-100">
                {/* Naming the button matters: only the whole-run button holds
                    these back. Scheduling a card on its own still posts it,
                    with fallback wording — saying "scheduling" flatly told him
                    a clip was protected when one route books it anyway. */}
                {failedCaptionCount} clip{failedCaptionCount === 1 ? " has" : "s have"} no AI caption — the button
                above leaves {failedCaptionCount === 1 ? "it" : "them"} out. Scheduling{" "}
                {failedCaptionCount === 1 ? "that card" : "those cards"} one at a time still posts with fallback
                wording.
              </span>
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={onRetryCaptions}
                disabled={bulkBusy}
              >
                {writingCaptions ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Retry the {failedCaptionCount} that failed
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {clips.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-10 text-center">
          <Film className="h-6 w-6 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">No clips in current run.</p>
          <p className="text-xs text-[var(--muted-foreground)]">Generate clips first, then schedule them here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clips.map((clip) => (
            <ClipCard
              key={clip.key}
              clip={clip}
              draft={draftFor(clip)}
              slots={slots}
              isSlotTaken={isSlotTaken}
              scheduledItems={itemsForClip(clip)}
              scheduling={busy === `schedule:${clip.key}`}
              highlighted={clip.key === highlightedKey}
              onDraftChange={(draft) => onDraftChange(clip, draft)}
              onTitleCommit={() => onTitleCommit(clip)}
              onSchedule={() => onSchedule(clip)}
              onEditClip={() => onEditClip(clip)}
              onTailorCaption={() => onTailorCaption(clip)}
              tailoring={busy === `tailor:${clip.key}` || writingCaptions}
              captionError={captionFailures[clip.key]}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
