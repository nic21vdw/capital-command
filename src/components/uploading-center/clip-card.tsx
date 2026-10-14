"use client";

import { useId, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  GripVertical,
  Loader2,
  Plus,
  Scissors,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClipPreview } from "@/components/uploading-center/clip-preview";
import { ExperimentPanel, ExperimentToggle, type ExperimentContext } from "@/components/uploading-center/experiment-panel";
import { bookedClip } from "@/components/uploading-center/booked-clip";
import { cardOptionsSummary } from "@/components/uploading-center/run-defaults";
import { StatusChip } from "@/components/uploading-center/status-chip";
import { formatClockTime, formatSlotDateTime } from "@/lib/timeFormat";
import { describeFailure } from "@/lib/publisher/failure";
import type { StatusTone } from "@/lib/statusTone";
import {
  isTiktokInboxDraft,
  legInFlight,
  pastSlotMarker,
  pendingHint,
  pendingLabel,
  POST_BY_HAND_LABEL,
  TIKTOK_INBOX_ACTION,
  TIKTOK_INBOX_HINT,
  waitingForConnectionHint
} from "@/lib/publisher/nativeScheduling";
import { youtubeHoldsForReview } from "@/lib/publisher/reviewHold";
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

/**
 * What the empty caption box promises (see `schedule`). Short on purpose: the
 * no-AI-key case is said on the Customise row above it ("Captions: the clip
 * titles"), not squeezed into a placeholder that gets cut off.
 */
export const CAPTION_EMPTY_PLACEHOLDER = "Leave empty and one is written when you schedule";

/**
 * How a hashtag chip says whether it is on. Every chip used to be the same
 * outline, so ten suggestions read as ten hashtags the clip already carried
 * (and a summary saying "no hashtags" read as wrong). Now ON is a filled chip
 * with a tick, and OFF is an outline with a plus: the mark says what a click
 * does as well as what is true now. Pure.
 */
export function hashtagChipStyle(selected: boolean): { className: string; mark: "check" | "plus" } {
  return selected
    ? {
        mark: "check",
        className:
          "border-[var(--accent)] bg-[var(--accent)] font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)]"
      }
    : {
        mark: "plus",
        className:
          "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      };
}

/** One hashtag chip: filled with a tick when on, outlined with a plus when off. */
export function HashtagChip({
  hashtag,
  selected,
  onClick,
  toggles = false
}: {
  hashtag: string;
  selected: boolean;
  onClick: () => void;
  /** A chip that can also be switched off (Customise); the card's only ever adds. */
  toggles?: boolean;
}) {
  const { className, mark } = hashtagChipStyle(selected);
  const Mark = mark === "check" ? Check : Plus;
  return (
    <button
      type="button"
      onClick={onClick}
      {...(toggles ? { "aria-pressed": selected } : { "aria-label": `Add ${hashtag} to the title` })}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition max-sm:min-h-10 max-sm:px-3",
        className
      )}
    >
      <Mark className="h-3 w-3" aria-hidden />
      {hashtag}
    </button>
  );
}

/** Append a hashtag to the title, keeping within the max title length. */
export function appendHashtag(title: string, hashtag: string): string {
  const trimmed = title.trimEnd();
  const next = trimmed.length > 0 ? `${trimmed} ${hashtag}` : hashtag;
  return next.length <= TITLE_MAX_LENGTH ? next : title;
}

export function hasHashtag(title: string, hashtag: string): boolean {
  return title.toLowerCase().includes(hashtag.toLowerCase());
}

/** Short, friendly timestamp like "Mon, Jul 14, 7:30 PM", on the wall clock of the publish zone. */
export function formatStamp(iso: string, timeZone: string): string {
  return formatSlotDateTime(iso, timeZone, { weekday: true });
}

/** Just the day part, like "Mon, Jul 14" (in the publish zone) — used for the "Uploaded …" confirmation. */
export function formatDay(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone,
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
  /** Secondary context: go-live time, reminder time, or the failure in words. */
  note: string;
  /** Longer text for the note's tooltip: what the wait means, or the platform's own error. */
  detail?: string;
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
 *
 * Every time is the wall clock of `timeZone` (the publish zone), never the
 * browser's, so the card agrees with the board whatever the browser is set to.
 */
export function summarizePlatformState(
  platform: PlatformId,
  state: PlatformState,
  item: Pick<QueueItem, "publishAt" | "createdAt" | "mediaKind" | "tiktok"> & { format?: "short" | "long"; clipPath?: string },
  timeZone: string,
  now: Date = new Date()
): PlatformSummary {
  const goLive = formatStamp(item.publishAt, timeZone);
  const uploadIso = state.uploadedAt ?? (state.postId ? item.createdAt : null);
  const uploaded = uploadIso ? `Uploaded ${formatDay(uploadIso, timeZone)}` : null;
  const heldPrivate = platform === "youtube" && youtubeHoldsForReview(item);
  const marker = pastSlotMarker(platform, state, item, now, { inFlight: legInFlight(state, now) });
  switch (state.status) {
    case "scheduled":
      // Past its slot on a platform that publishes by itself: it should be live by now.
      if (marker?.kind === "should-be-live") return { uploaded, note: `${marker.hint} Slot was ${goLive}.` };
      // A TikTok inbox delivery is recorded as "scheduled" but is a draft the
      // creator still has to finish in the app; "Goes live" would be a lie.
      if (isTiktokInboxDraft(platform, state.status, item)) {
        return { uploaded, note: `In your TikTok inbox - ${TIKTOK_INBOX_ACTION}`, detail: TIKTOK_INBOX_HINT };
      }
      return {
        uploaded,
        note: heldPrivate ? "Private on YouTube - make it public after you review it" : `Goes live ${goLive}`
      };
    case "published":
      return {
        uploaded: uploaded ?? `Uploaded ${formatDay(state.publishedAt ?? item.publishAt, timeZone)}`,
        note: heldPrivate
          ? "Private on YouTube - make it public after you review it"
          : `Live since ${formatStamp(state.publishedAt ?? item.publishAt, timeZone)}`
      };
    case "uploaded":
      return { uploaded, note: `Processing · goes live ${goLive}` };
    case "pending":
      // The same words the board's chip uses: "Uploading" is only true on a
      // platform that takes the file ahead of time; the rest post at the slot.
      return {
        uploaded: null,
        note: `${pendingLabel(platform, item, now, { inFlight: legInFlight(state, now) })} · slot ${goLive}`,
        detail: pendingHint(platform, item, now, { inFlight: legInFlight(state, now) })
      };
    case "manual":
      // Before the slot it is waiting for a connection (the chip's words); after
      // it, it was missed and is left to be posted by hand.
      return {
        uploaded: null,
        note:
          new Date(item.publishAt).getTime() > now.getTime()
            ? waitingForConnectionHint(platform, goLive).replace(/\.$/, "")
            : `${POST_BY_HAND_LABEL} - the ${goLive} slot passed without a connection`
      };
    case "failed": {
      if (!state.error) return { uploaded: null, note: "Upload failed" };
      const advice = describeFailure(state, platform);
      return { uploaded: null, note: `Upload failed - ${advice.headline}`, detail: advice.raw };
    }
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
/** The booked row's icon follows the same tone as its words (see bookedClip). */
function BookedIcon({ tone }: { tone: StatusTone }) {
  const className = `tone-${tone} tone-text mt-0.5 h-3.5 w-3.5 shrink-0`;
  if (tone === "warning" || tone === "danger") return <TriangleAlert className={className} aria-hidden />;
  if (tone === "info") return <CalendarClock className={className} aria-hidden />;
  return <CheckCircle2 className={className} aria-hidden />;
}

export function ClipCard({
  clip,
  draft,
  tiktokAccountId,
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
  captionError,
  targetLabels = PLATFORM_TARGET_LABELS,
  targetHints,
  scheduleDisabledReason,
  timeZone,
  aiCopyAvailable,
  onShowOnBoard,
  isConnected,
  experiment
}: {
  clip: ReadyClip;
  draft: ClipDraft;
  tiktokAccountId: string;
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
  /** The platform picker's wording (names the YouTube mirror when it is on). */
  targetLabels?: Record<PlatformTarget, string>;
  /** What each platform option books, as a line under the picker. */
  targetHints?: Record<PlatformTarget, string>;
  /** Set while posting is switched off: Schedule is disabled and this says why. */
  scheduleDisabledReason?: string;
  /** The publish zone (overview.timezone): every time on the card is shown on its wall clock. */
  timeZone: string;
  /** Whether a model can write captions (overview.aiCopyAvailable); undefined until known. */
  aiCopyAvailable?: boolean;
  /** Bring this clip's booking into view on the board (switches tab and day as needed). */
  onShowOnBoard?: (item: QueueItem) => void;
  /** Whether the account a post uses on a platform has a connection - the booked row says what the board's chip says. */
  isConnected?: (platform: PlatformId, accountId: string) => boolean;
  /** Offers Test titles on the card. Absent means the card has no experiment button. */
  experiment?: ExperimentContext;
}) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [testing, setTesting] = useState(false);
  // The hashtag chips and the caption box are closed behind Customise: a draft
  // that is fine as it is should read as one title, a slot and a button, not as
  // a form of ten chips and a text box. The closed row says what they hold.
  const [customising, setCustomising] = useState(false);
  const customiseId = useId();
  // A booked clip is a one-line row until someone asks to book it again; the
  // draft (title, caption, platform) is kept either way, only hidden.
  const [editing, setEditing] = useState(false);
  const booked = bookedClip(scheduledItems, (iso) => formatStamp(iso, timeZone), { isConnected });
  const collapsed = booked !== null && !editing && !highlighted;
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
  const customiseSummary = cardOptionsSummary(draft, aiCopyAvailable);
  const experimentBlocker = !experiment
    ? undefined
    : (experiment.disabledReason ??
      (needsRerender
        ? "Render your trim first (schedule the clip or open the editor), so the test uses the edited cut."
        : booked
          ? "This clip is already scheduled. A test can only start from a clip that is not scheduled yet."
          : undefined));

  if (booked && collapsed) {
    return (
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(CLIP_DRAG_TYPE, clip.key);
          event.dataTransfer.effectAllowed = "copy";
        }}
        className="@container min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2.5 transition hover:border-[var(--border-strong)]"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 shrink-0 self-start">
            <ClipPreview
              thumbnailUrl={clip.thumbnailUrl}
              previewUrl={clip.previewUrl}
              headline={clip.headline}
              durationSec={clip.durationSec}
              startSec={clip.startSec}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="line-clamp-2 break-words text-sm font-medium text-white" title={booked.title}>
              {booked.title}
            </p>
            <p className="flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
              <BookedIcon tone={booked.tone} />
              <span className="min-w-0 break-words">{booked.label}</span>
            </p>
            {booked.failedLegs > 0 ? (
              <p className="tone-danger tone-text text-[11px]">
                {booked.failedLegs} post{booked.failedLegs === 1 ? "" : "s"} failed - see the board
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {onShowOnBoard ? (
                <button
                  type="button"
                  onClick={() => onShowOnBoard(booked.item)}
                  className="font-medium text-[var(--accent)] underline-offset-2 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
                >
                  Show on the board
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-expanded={false}
                title="Open the draft title, caption and slot controls to book this clip again. Posts already scheduled do not change."
                className="font-medium text-[var(--muted-foreground)] underline-offset-2 hover:text-white hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
              >
                Edit for a new booking
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CLIP_DRAG_TYPE, clip.key);
        event.dataTransfer.effectAllowed = "copy";
      }}
      className={cn(
        "@container min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 transition hover:border-[var(--border-strong)]",
        captionFailed && "tone-warning tone-edge",
        highlighted && "border-[var(--accent)] ring-1 ring-[var(--accent)]/50"
      )}
    >
      {booked ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] pb-2 text-xs">
          <span className="min-w-0 break-words text-[var(--muted-foreground)]">{booked.label}</span>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-expanded={true}
            className="shrink-0 font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          >
            Hide the draft controls
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 @min-[360px]:flex-row">
        <div className="w-20 shrink-0 self-start @min-[360px]:w-24">
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
              aria-label="Post title"
              className="field-sizing-content min-h-9 min-w-0 flex-1 resize-none py-2"
            />
          </div>
          <div className="pl-6">
            <button
              type="button"
              onClick={() => setCustomising((open) => !open)}
              aria-expanded={customising}
              aria-controls={customiseId}
              className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--well)] px-2.5 py-1.5 text-left text-xs text-[var(--muted-foreground)] transition hover:text-white max-sm:min-h-10"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", customising && "rotate-180")} aria-hidden />
              <span className="shrink-0 font-medium">Customise</span>
              <span className="min-w-0 flex-1 truncate" title={customiseSummary}>
                {customiseSummary}
              </span>
            </button>
          </div>
          {customising ? (
            <div id={customiseId} className="space-y-2">
              {/* One-click hashtag suggestions, appended to the title like YouTube's
                  tag chips. Chips already present in the title (or that would push
                  it past the length limit) are hidden. */}
              <div className="flex flex-wrap gap-1.5 pl-6">
                {SUGGESTED_HASHTAGS.filter(
                  (hashtag) =>
                    !hasHashtag(draft.title, hashtag) && appendHashtag(draft.title, hashtag) !== draft.title
                ).map((hashtag) => (
                  <HashtagChip
                    key={hashtag}
                    hashtag={hashtag}
                    selected={false}
                    onClick={() => {
                      onDraftChange({ ...draft, title: appendHashtag(draft.title, hashtag) });
                      titleRef.current?.focus();
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 pl-6">
                <span
                  className="min-w-0 text-[11px] text-[var(--muted-foreground)]"
                  title={
                    scheduledItems.length > 0
                      ? "Draft caption - used for new bookings. Edit scheduled posts on the board."
                      : undefined
                  }
                >
                  {scheduledItems.length > 0 ? "Draft caption" : "Caption"}
                </span>
                {onTailorCaption ? (
                  <button
                    type="button"
                    onClick={onTailorCaption}
                    disabled={tailoring}
                    title={`Write a caption + hashtags tailored to ${targetLabel} (free AI)`}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60 max-sm:min-h-10 max-sm:px-3"
                  >
                    {tailoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {tailoring ? "Writing…" : `AI caption for ${targetLabel}`}
                  </button>
                ) : null}
              </div>
              <Textarea
                aria-label="Caption"
                value={draft.caption}
                onChange={(event) => onDraftChange({ ...draft, caption: event.target.value })}
                placeholder={
                  scheduledItems.length > 0
                    ? "Draft for new bookings only"
                    : CAPTION_EMPTY_PLACEHOLDER
                }
                className={cn("min-h-16 py-2", captionFailed && "tone-warning tone-edge")}
              />
            </div>
          ) : null}
          {captionFailed ? (
            <p className="tone-warning tone-edge tone-soft tone-text flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No AI caption for this clip — {captionError?.replace(/\s*[.!]+$/, "")}. Scheduling the whole run
                leaves this one out; retry above, or{" "}
                <button
                  type="button"
                  onClick={() => setCustomising(true)}
                  className="font-semibold underline underline-offset-2 hover:opacity-80"
                >
                  write the caption yourself
                </button>
                .
              </span>
            </p>
          ) : null}
          {tiktokTargeted ? (
            <TiktokConsent value={draft.tiktok} accountId={tiktokAccountId} onChange={(tiktok) => onDraftChange({ ...draft, tiktok })} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={draft.platform}
              onChange={(event) =>
                onDraftChange({ ...draft, platform: event.target.value as PlatformTarget, slotUtc: "" })
              }
              className="h-9 w-full min-w-28 sm:w-auto"
              aria-label="Platform"
            >
              {(Object.keys(targetLabels) as PlatformTarget[]).map((target) => (
                <option key={target} value={target}>
                  {targetLabels[target]}
                </option>
              ))}
            </Select>
            <Select
              value={draft.slotUtc}
              onChange={(event) => onDraftChange({ ...draft, slotUtc: event.target.value })}
              className="h-9 w-auto min-w-0 flex-1 basis-40"
              aria-label="Schedule slot"
            >
              <option value="">{everywhere ? "Pick a slot open everywhere…" : "Pick a slot…"}</option>
              {openSlots.map((slot) => (
                <option key={slot.id} value={slot.utc}>
                  {slot.dateLabel} · {formatClockTime(slot.time)}
                </option>
              ))}
            </Select>
            <Button
              onClick={onSchedule}
              disabled={scheduling || !draft.slotUtc || Boolean(consentBlocker) || Boolean(scheduleDisabledReason)}
              className="h-9 px-3"
              title={
                scheduleDisabledReason
                  ? scheduleDisabledReason
                  : consentBlocker
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
              isn&apos;t connected saves as a reminder.
            </p>
          ) : targetHints?.[draft.platform] ? (
            <p className="text-[11px] text-[var(--muted-foreground)]">{targetHints[draft.platform]}</p>
          ) : null}
          {needsRerender ? (
            <button
              type="button"
              onClick={onEditClip}
              className="tone-warning tone-edge tone-soft tone-text flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition hover:opacity-90"
            >
              <Scissors className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Your trim will be rendered automatically when you schedule this clip — or
                <span className="font-semibold"> open the editor</span> to fine-tune it first.
              </span>
            </button>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-2">
            {scheduledItems.length === 0 ? (
              <StatusChip status="draft" />
            ) : (
              <div className="min-w-48 flex-1 space-y-1.5">
                {scheduledItems.map((item) =>
                (Object.entries(item.platforms) as [PlatformId, NonNullable<QueueItem["platforms"][PlatformId]>][]).map(
                  ([platform, state]) => {
                    const url = remoteUrlFor(platform, state.postId);
                    const summary = summarizePlatformState(platform, state, item, timeZone);
                    return (
                      <div key={`${item.id}:${platform}`} className="space-y-0.5 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[var(--muted-foreground)]">
                          <StatusChip
                            status={state.status}
                            platform={platform}
                            item={item}
                            leg={state}
                            className="max-w-full whitespace-normal!"
                          />
                          <span className="whitespace-nowrap font-medium text-white">{PLATFORM_LABELS[platform]}</span>
                          {summary.uploaded ? (
                            <span className="tone-success tone-text inline-flex items-center gap-1 whitespace-nowrap">
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
                        <span className="block break-words pl-0.5 text-[var(--muted-foreground)]" title={summary.detail}>
                          {summary.note}
                        </span>
                      </div>
                    );
                  }
                )
                )}
              </div>
            )}
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              {experiment ? <ExperimentToggle open={testing} onToggle={() => setTesting((open) => !open)} disabledReason={experimentBlocker} /> : null}
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
          {experiment && testing && !experimentBlocker ? (
            <ExperimentPanel clip={clip} draft={draft} context={experiment} onClose={() => setTesting(false)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
