"use client";

import { Film } from "lucide-react";
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
  isSlotTaken,
  itemsForClip,
  busy,
  onSchedule
}: {
  jobs: ClipJob[];
  activeJob: ClipJob | null;
  onSelectJob: (jobId: string) => void;
  clips: ReadyClip[];
  slots: ScheduleSlot[];
  draftFor: (clip: ReadyClip) => ClipDraft;
  onDraftChange: (clip: ReadyClip, draft: ClipDraft) => void;
  isSlotTaken: (platform: PlatformId, slotUtc: string) => boolean;
  itemsForClip: (clip: ReadyClip) => QueueItem[];
  busy: string | null;
  onSchedule: (clip: ReadyClip) => void;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
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
              onDraftChange={(draft) => onDraftChange(clip, draft)}
              onSchedule={() => onSchedule(clip)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
