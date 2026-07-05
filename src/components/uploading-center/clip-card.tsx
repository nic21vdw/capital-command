"use client";

import { CalendarClock, ExternalLink, GripVertical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
  onDraftChange,
  onSchedule
}: {
  clip: ReadyClip;
  draft: ClipDraft;
  slots: ScheduleSlot[];
  isSlotTaken: (platform: PlatformId, slotUtc: string) => boolean;
  scheduledItems: QueueItem[];
  scheduling: boolean;
  onDraftChange: (draft: ClipDraft) => void;
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
      className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 transition hover:border-[var(--border-strong)]"
    >
      <div className="flex gap-3">
        <div className="relative w-24 shrink-0 self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={clip.thumbnailUrl}
            alt=""
            className="aspect-[9/16] w-full rounded-lg border border-[var(--border)] bg-black object-cover"
            loading="lazy"
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
            {formatDuration(clip.durationSec)}
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2">
            <GripVertical className="mt-3 h-4 w-4 shrink-0 cursor-grab text-[var(--muted-foreground)]" />
            <Input
              value={draft.title}
              maxLength={100}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              placeholder="Title"
              className="h-9"
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
