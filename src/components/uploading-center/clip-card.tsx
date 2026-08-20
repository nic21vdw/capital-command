"use client";

import { useRef } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  GripVertical,
  Loader2,
  Scissors,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClipPreview } from "@/components/uploading-center/clip-preview";
import { StatusChip } from "@/components/uploading-center/status-chip";
import {
  PLATFORM_LABELS,
  PLATFORM_TARGET_LABELS,
  remoteUrlFor,
  type ClipDraft,
  type PlatformTarget,
  type ReadyClip
} from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";
import { TiktokConsent } from "@/components/uploading-center/tiktok-consent";
import { consentProblem } from "@/lib/publisher/tiktokPost";

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

export function hasHashtag(title: string, hashtag: string): boolean {
  return title.toLowerCase().includes(hashtag.toLowerCase());
}

/** Short, friendly local timestamp like "Mon, Jul 14, 7:30 PM". */
export function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** Just the day part, like "Mon, Jul 14" — used for the "Uploaded …" confirmation. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export type PlatformSummary = {
  /**
   * "Uploaded Mon, Jul 14" once the bytes actually reached the platform, so a
   * scheduled clip reads as genuinely uploaded and not merely planned. Null
   * before anything has been sent.
   */
  uploaded: string | null;
  /** Secondary context: go-live time, reminder time, or the failure reason. */
  note: string;
};

/**
 * A human summary of where a single platform post stands. YouTube uploads land
 * on the channel the moment they're scheduled (private + publishAt), so the
 * card must confirm the upload day up front — otherwise a future go-live time
 * next to a "Scheduled" chip makes it look like nothing was uploaded at all.
 *
 * `uploadedAt` is stamped by the runner on the first successful upload; older
 * items that predate that stamp fall back to when the post was created (a
 * YouTube post with a video id has definitely been uploaded).
 */
export function summarizePlatformState(
  platform: PlatformId,
  state: PlatformState,
  item: { publishAt: string; createdAt: string }
): PlatformSummary {
  const goLive = formatStamp(item.publishAt);
  const uploadIso = state.uploadedAt ?? (state.postId ? item.createdAt : null);
  const uploaded = uploadIso ? `Uploaded ${formatDay(uploadIso)}` : null;
  switch (state.status) {
    case "scheduled":
      return { uploaded, note: `Goes live ${goLive}` };
    case "published":
      return {
        uploaded: uploaded ?? `Uploaded ${formatDay(state.publishedAt ?? item.publishAt)}`,
        note: `Live since ${formatStamp(state.publishedAt ?? item.publishAt)}`
      };
    case "uploaded":
      return { uploaded, note: `Processing · goes live ${goLive}` };
    case "pending":
      return { uploaded: null, note: `Uploading… · scheduled for ${goLive}` };
    case "manual":
      return { uploaded: null, note: `Manual reminder for ${goLive}` };
    case "failed":
      return { uploaded: null, note: state.error ? `Upload failed — ${state.error}` : "Upload failed" };
    default:
      return { uploaded, note: `Scheduled for ${goLive}` };
  }
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
  tailoring = false,
  captionError
}: {
  clip: ReadyClip;
  draft: ClipDraft;
  slots: ScheduleSlot[];
  /** True when the slot is already booked on the card's target — on every one
   *  of its platforms when that target is "All platforms". */
  isSlotTaken: (target: PlatformTarget, slotUtc: string) => boolean;
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
  /** Why this clip's AI caption failed, when it did. */
  captionError?: string;
}) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // `bookable` excludes today as well as the past: nothing is scheduled for the
  // day it is booked (see src/lib/publisher/schedule.ts).
  const openSlots = slots.filter((slot) => slot.bookable && !isSlotTaken(draft.platform, slot.utc));
  const everywhere = draft.platform === "all";
  const targetLabel =
    draft.platform === "all" ? "all platforms" : PLATFORM_LABELS[draft.platform];
  // A clip whose trim/edits haven't been baked into a render yet still schedules
  // fine — scheduling renders the trimmed cut first, then posts it — so the note
  // below is informational, not a block.
  const needsRerender = clip.needsRerender;
  const tiktokTargeted = draft.platform === "tiktok" || everywhere;
  // TikTok's own rules, applied where the button is: a direct post with an
  // unanswered question is not schedulable at all.
  const consentBlocker = tiktokTargeted && draft.tiktok ? consentProblem(draft.tiktok) : null;
  // Only while the caption is still empty: once there is copy in the box, typed
  // or retried, the clip is no longer the one that quietly went out uncaptioned.
  const captionFailed = Boolean(captionError) && !draft.caption.trim();

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CLIP_DRAG_TYPE, clip.key);
        event.dataTransfer.effectAllowed = "copy";
      }}
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 transition hover:border-[var(--border-strong)]",
        captionFailed && "border-amber-400/50",
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
                title={`Write a caption + hashtags tailored to ${targetLabel} (free AI)`}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              >
                {tailoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {tailoring ? "Writing…" : `AI caption for ${targetLabel}`}
              </button>
            ) : null}
          </div>
          <Textarea
            value={draft.caption}
            onChange={(event) => onDraftChange({ ...draft, caption: event.target.value })}
            placeholder="Caption — leave empty to auto-generate on schedule"
            className={cn("min-h-16 py-2", captionFailed && "border-amber-400/40")}
          />
          {captionFailed ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No AI caption for this clip — {captionError?.replace(/\s*[.!]+$/, "")}. Scheduling the whole run
                leaves this one out; retry above, or write the caption yourself.
              </span>
            </p>
          ) : null}
          {tiktokTargeted ? (
            <TiktokConsent value={draft.tiktok} onChange={(tiktok) => onDraftChange({ ...draft, tiktok })} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={draft.platform}
              onChange={(event) =>
                onDraftChange({ ...draft, platform: event.target.value as PlatformTarget, slotUtc: "" })
              }
              className="h-9 w-auto min-w-28"
              aria-label="Platform"
            >
              {(Object.keys(PLATFORM_TARGET_LABELS) as PlatformTarget[]).map((target) => (
                <option key={target} value={target}>
                  {PLATFORM_TARGET_LABELS[target]}
                </option>
              ))}
            </Select>
            <Select
              value={draft.slotUtc}
              onChange={(event) => onDraftChange({ ...draft, slotUtc: event.target.value })}
              className="h-9 w-auto min-w-40 flex-1"
              aria-label="Schedule slot"
            >
              <option value="">{everywhere ? "Pick a slot open everywhere…" : "Pick a slot…"}</option>
              {openSlots.map((slot) => (
                <option key={slot.id} value={slot.utc}>
                  {slot.dateLabel} · {slot.time}
                </option>
              ))}
            </Select>
            <Button
              onClick={onSchedule}
              disabled={scheduling || !draft.slotUtc || Boolean(consentBlocker)}
              className="h-9 px-3"
              title={
                consentBlocker
                  ? consentBlocker
                  : everywhere
                  ? "Schedules this clip on YouTube, TikTok, Instagram and Facebook at that slot"
                  : needsRerender
                    ? "Renders your trimmed clip, then schedules it"
                    : undefined
              }
            >
              {scheduling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}
              {scheduling && needsRerender ? "Baking…" : everywhere ? "Schedule everywhere" : "Schedule"}
            </Button>
          </div>
          {everywhere ? (
            <p className="pl-6 text-[11px] text-[var(--muted-foreground)]">
              One post per platform at the same slot, each on that platform&apos;s selected account. A platform that
              isn&apos;t connected saves as a manual reminder.
            </p>
          ) : null}
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
              <div className="min-w-0 flex-1 space-y-1.5">
                {scheduledItems.map((item) =>
                (Object.entries(item.platforms) as [PlatformId, NonNullable<QueueItem["platforms"][PlatformId]>][]).map(
                  ([platform, state]) => {
                    const url = remoteUrlFor(platform, state.postId);
                    const summary = summarizePlatformState(platform, state, item);
                    return (
                      <div key={`${item.id}:${platform}`} className="space-y-0.5 text-xs">
                        <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                          <StatusChip status={state.status} platform={platform} item={item} />
                          <span className="truncate font-medium text-white">{PLATFORM_LABELS[platform]}</span>
                          {summary.uploaded ? (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" /> {summary.uploaded}
                            </span>
                          ) : null}
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className={cn("ml-auto inline-flex items-center gap-1 text-[var(--accent)] hover:underline")}
                            >
                              Open <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                        <span className="block truncate pl-0.5 text-[var(--muted-foreground)]">{summary.note}</span>
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
