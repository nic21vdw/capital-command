"use client";

import { useRef } from "react";
import { CalendarClock, ExternalLink, GripVertical, Loader2, Scissors, Sparkles } from "lucide-react";
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
  onEditClip,
  onTailorCaption,
  tailoring = false
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
  /** Tailor the caption to the selected platform with the free AI provider. */
  onTailorCaption?: () => void;
  /** True while the AI caption is being generated. */
  tailoring?: boolean;
}) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const openSlots = slots.filter((slot) => !slot.past && !isSlotTaken(draft.platform, slot.utc));
  // A clip whose trim/edits haven't been baked into a render yet still schedules
  // fine — scheduling renders the trimmed cut first, then posts it — so the note
  // below is informational, not a block.
  const needsRerender = clip.needsRerender;

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
            startSec={clip.startSec}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2">
            <GripVertical className="mt-3 h-4 w-4 shrink-0 cursor-grab text-[var(--muted-foreground)]" />
            {/* Wrapping textarea (not a single-line input) so long titles stay
                fully visible; field-sizing grows it to fit the content. */}
            <Textarea
              ref={titleRef}
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
          {/* One-click hashtag suggestions, appended to the title like YouTube's
              tag chips. Chips already present in the title (or that would push
              it past the length limit) are hidden. */}
          <div className="flex flex-wrap gap-1.5 pl-6">
            {SUGGESTED_HASHTAGS.filter(
              (hashtag) =>
                !hasHashtag(draft.title, hashtag) && appendHashtag(draft.title, hashtag) !== draft.title
            ).map((hashtag) => (
              <button
                key={hashtag}
                type="button"
                onClick={() => {
                  onDraftChange({ ...draft, title: appendHashtag(draft.title, hashtag) });
                  titleRef.current?.focus();
                }}
                className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {hashtag}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pl-6">
            <span className="text-[11px] text-[var(--muted-foreground)]">Caption</span>
            {onTailorCaption ? (
              <button
                type="button"
                onClick={onTailorCaption}
                disabled={tailoring}
                title={`Write a caption + hashtags tailored to ${PLATFORM_LABELS[draft.platform]} (free AI)`}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              >
                {tailoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {tailoring ? "Writing…" : `AI caption for ${PLATFORM_LABELS[draft.platform]}`}
              </button>
            ) : null}
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
            <Button
              onClick={onSchedule}
              disabled={scheduling || !draft.slotUtc}
              className="h-9 px-3"
              title={needsRerender ? "Renders your trimmed clip, then schedules it" : undefined}
            >
              {scheduling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}
              {scheduling && needsRerender ? "Baking…" : "Schedule"}
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
                Your trim will be rendered automatically when you schedule this clip — or
                <span className="font-semibold"> open the editor</span> to fine-tune it first.
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
