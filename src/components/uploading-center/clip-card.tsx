"use client";

import { CalendarClock, ExternalLink, GripVertical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClipPreview } from "@/components/uploading-center/clip-preview";
import { StatusChip } from "@/components/uploading-center/status-chip";
import {
  PLATFORM_LABELS,
  remoteUrlFor,
  type ClipDraft,
  type ReadyClip
} from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

export const CLIP_DRAG_TYPE = "application/x-capital-command-clip";

/**
 * One clip from the current run: thumbnail, editable title/caption, platform
 * target, slot picker, and the status of every post already created from it.
 * Drag the card onto an empty slot in the schedule board, or pick a slot here
 * and hit Schedule.
 */
export function ClipCard({
  clip,
  draft,
  slots,
  isSlotTaken,
  scheduledItems,
  scheduling,
  highlighted = false,
  onDraftChange,
  onTitleCommit,
  onSchedule
}: {
  clip: ReadyClip;
  draft: ClipDraft;
  slots: ScheduleSlot[];
  isSlotTaken: (platform: PlatformId, slotUtc: string) => boolean;
  scheduledItems: QueueItem[];
  scheduling: boolean;
  /** Accent ring while this clip is being placed onto the board. */
  highlighted?: boolean;
  onDraftChange: (draft: ClipDraft) => void;
  /** Persist the typed title (fires on blur/Enter, not on every keystroke). */
  onTitleCommit: () => void;
  onSchedule: () => void;
}) {
  const openSlots = slots.filter((slot) => !slot.past && !isSlotTaken(draft.platform, slot.utc));

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CLIP_DRAG_TYPE, clip.key);
        event.dataTransfer.effectAllowed = "copy";
      }}
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 transition hover:border-[var(--border-strong)]",
        highlighted && "border-[var(--accent)] ring-1 ring-[var(--accent)]/50"
      )}
    >
      <div className="flex gap-3">
        <div className="w-24 shrink-0 self-start">
          <ClipPreview
            thumbnailUrl={clip.thumbnailUrl}
            previewUrl={clip.previewUrl}
            headline={clip.headline}
            durationSec={clip.durationSec}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2">
            <GripVertical className="mt-3 h-4 w-4 shrink-0 cursor-grab text-[var(--muted-foreground)]" />
            {/* Wrapping textarea (not a single-line input) so long titles stay
                fully visible; field-sizing grows it to fit the content. */}
            <Textarea
              value={draft.title}
              maxLength={100}
              rows={1}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value.replace(/\n/g, " ") })}
              onBlur={onTitleCommit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="Title"
              className="field-sizing-content min-h-9 resize-none py-2"
            />
          </div>
          <Textarea
            value={draft.caption}
            onChange={(event) => onDraftChange({ ...draft, caption: event.target.value })}
            placeholder="Caption — leave empty to auto-generate on schedule"
            className="min-h-16 py-2"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={draft.platform}
              onChange={(event) => onDraftChange({ ...draft, platform: event.target.value as PlatformId, slotUtc: "" })}
              className="h-9 w-auto min-w-28"
              aria-label="Platform"
            >
              {(Object.keys(PLATFORM_LABELS) as PlatformId[]).map((platform) => (
                <option key={platform} value={platform}>
                  {PLATFORM_LABELS[platform]}
                </option>
              ))}
            </Select>
            <Select
              value={draft.slotUtc}
              onChange={(event) => onDraftChange({ ...draft, slotUtc: event.target.value })}
              className="h-9 w-auto min-w-40 flex-1"
              aria-label="Schedule slot"
            >
              <option value="">Pick a slot…</option>
              {openSlots.map((slot) => (
                <option key={slot.id} value={slot.utc}>
                  {slot.dateLabel} · {slot.time}
                </option>
              ))}
            </Select>
            <Button onClick={onSchedule} disabled={scheduling || !draft.slotUtc} className="h-9 px-3">
              {scheduling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}
              Schedule
            </Button>
          </div>
          {scheduledItems.length === 0 ? (
            <StatusChip status="draft" />
          ) : (
            <div className="space-y-1">
              {scheduledItems.map((item) =>
                (Object.entries(item.platforms) as [PlatformId, NonNullable<QueueItem["platforms"][PlatformId]>][]).map(
                  ([platform, state]) => {
                    const url = remoteUrlFor(platform, state.postId);
                    return (
                      <div key={`${item.id}:${platform}`} className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                        <StatusChip status={state.status} />
                        <span className="truncate">
                          {PLATFORM_LABELS[platform]} · {new Date(item.publishAt).toLocaleString()}
                        </span>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className={cn("inline-flex items-center gap-1 text-[var(--accent)] hover:underline")}
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    );
                  }
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
