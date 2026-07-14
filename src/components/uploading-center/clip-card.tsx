"use client";

import { CalendarClock, ExternalLink, GripVertical, Loader2, Scissors } from "lucide-react";
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

export const TITLE_MAX_LENGTH = 100;

/** Hashtags offered as one-click suggestions under the title field. */
export const SUGGESTED_HASHTAGS = [
  "#AI",
  "#vibecoding",
  "#coding",
  "#business",
  "#buildinpublic",
  "#startup",
  "#tech",
  "#programming",
  "#automation",
  "#entrepreneur"
];

/** Append a hashtag to the title, keeping within the max title length. */
export function appendHashtag(title: string, hashtag: string): string {
  const trimmed = title.trimEnd();
  const next = trimmed.length > 0 ? `${trimmed} ${hashtag}` : hashtag;
  return next.length <= TITLE_MAX_LENGTH ? next : title;
}

function hasHashtag(title: string, hashtag: string): boolean {
  return title.toLowerCase().includes(hashtag.toLowerCase());
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
  highlighted = false,
  onDraftChange,
  onTitleCommit,
  onSchedule,
  onEditClip
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
  /** Open this clip in the Clip Editor to trim/caption before scheduling. */
  onEditClip: () => void;
}) {
  const openSlots = slots.filter((slot) => !slot.past && !isSlotTaken(draft.platform, slot.utc));
  // A clip whose trim/edits haven't been rendered can't be scheduled — posting
  // it now would upload the wrong cut — so drag and Schedule are locked until
  // it's re-rendered from the editor.
  const needsRerender = clip.needsRerender;

  return (
    <div
      draggable={!needsRerender}
      onDragStart={(event) => {
        if (needsRerender) {
          event.preventDefault();
          return;
        }
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
            startSec={clip.startSec}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2">
            <GripVertical className="mt-3 h-4 w-4 shrink-0 cursor-grab text-[var(--muted-foreground)]" />
            {/* Wrapping textarea (not a single-line input) so long titles stay
                fully visible; field-sizing grows it to fit the content. */}
            <Textarea
              value={draft.title}
              maxLength={TITLE_MAX_LENGTH}
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
            placeholder="Clip description"
            className="min-h-24 py-2"
          />
          <div className="flex flex-wrap items-center gap-1.5 pl-6" aria-label="Automatic clip hashtags">
            <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Auto tags
            </span>
            {draft.hashtags.slice(0, 5).map((hashtag) => (
              <span
                key={hashtag}
                className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/8 px-2 py-0.5 text-[11px] text-[var(--accent)]"
              >
                {hashtag}
              </span>
            ))}
          </div>
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
            <Button
              onClick={onSchedule}
              disabled={scheduling || !draft.slotUtc || needsRerender}
              className="h-9 px-3"
              title={needsRerender ? "Re-render this clip in the editor before scheduling" : undefined}
            >
              {scheduling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}
              Schedule
            </Button>
          </div>
          {needsRerender ? (
            <button
              type="button"
              onClick={onEditClip}
              className="flex w-full items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-left text-xs text-amber-200 transition hover:border-amber-400/50"
            >
              <Scissors className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Your trim isn&apos;t baked in yet — open the editor and hit
                <span className="font-semibold"> Schedule Short</span> to render the trimmed clip before uploading.
              </span>
            </button>
          ) : null}
          <div className="flex items-start justify-between gap-2">
            {scheduledItems.length === 0 ? (
              <StatusChip status="draft" />
            ) : (
              <div className="min-w-0 flex-1 space-y-1">
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
            <Button
              variant="secondary"
              onClick={onEditClip}
              className="h-8 shrink-0 px-2.5 text-xs"
              title="Open this clip in the Clip Editor to trim, caption, and lay it out"
            >
              <Scissors className="mr-1.5 h-3.5 w-3.5" />
              Edit clip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
