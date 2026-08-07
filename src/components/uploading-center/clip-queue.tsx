"use client";

import { Film, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
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
 * default; older runs are reachable from the picker). The run's platform and
 * hashtags are set once at the top and every card follows them; each card can
 * still be scheduled inline or dragged onto the board.
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
  captionProgress
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
            <Button
              variant="secondary"
              className="h-9 px-3 text-xs"
              onClick={onAutoAssign}
              disabled={bulkBusy}
              title="Caption every unscheduled clip in this run, then assign them to the next open slots"
            >
              {autoAssigning ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Auto Assign
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
            />
          ))}
        </div>
      )}
    </Card>
  );
}
