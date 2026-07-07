"use client";

import { Film, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ClipCard } from "@/components/uploading-center/clip-card";
import type { ClipDraft, ReadyClip } from "@/components/uploading-center/use-uploading-center";
import type { ClipJob } from "@/lib/clipping/types";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * The clips produced by the current run (newest job with rendered clips by
 * default; older runs are reachable from the picker). Each card can be
 * scheduled inline or dragged onto the board.
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
  onAutoAssign
}: {
  jobs: ClipJob[];
  activeJob: ClipJob | null;
  onSelectJob: (jobId: string) => void;
  clips: ReadyClip[];
  slots: ScheduleSlot[];
  draftFor: (clip: ReadyClip) => ClipDraft;
  onDraftChange: (clip: ReadyClip, draft: ClipDraft) => void;
  onTitleCommit: (clip: ReadyClip) => void;
  isSlotTaken: (platform: PlatformId, slotUtc: string) => boolean;
  itemsForClip: (clip: ReadyClip) => QueueItem[];
  busy: string | null;
  /** Clip currently being placed onto the board (arrived via Schedule Short). */
  highlightedKey?: string | null;
  onSchedule: (clip: ReadyClip) => void;
  /** Open the given clip in the Clip Editor. */
  onEditClip: (clip: ReadyClip) => void;
  onAutoAssign: () => void;
}) {
  const autoAssigning = busy === "auto-assign";
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Clips in this run</h2>
        <div className="flex items-center gap-2">
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
          {clips.length > 0 ? (
            <Button
              variant="secondary"
              className="h-9 px-3 text-xs"
              onClick={onAutoAssign}
              disabled={autoAssigning}
              title="Assign every unscheduled clip in this run to the next open slots"
            >
              {autoAssigning ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Auto Assign
            </Button>
          ) : null}
        </div>
      </div>
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
            />
          ))}
        </div>
      )}
    </Card>
  );
}
