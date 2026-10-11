"use client";

import Link from "next/link";
import { CheckCircle2, Film, Loader2, RotateCcw, Sparkles, TriangleAlert, Wand2, X } from "lucide-react";
import { AdvancedOptions } from "@/components/ui/advanced-options";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { bulkBookingLabel, bulkBookingParts, planAutoAssign, type ShortsCap } from "@/components/uploading-center/bulk";
import { ClipCard, HashtagChip, SUGGESTED_HASHTAGS } from "@/components/uploading-center/clip-card";
import { captionSummary, hashtagSummary, runHashtags, type RunDefaults } from "@/components/uploading-center/run-defaults";
import {
  PLATFORM_TARGET_LABELS,
  type ClipDraft,
  type PlatformTarget,
  type ReadyClip
} from "@/components/uploading-center/use-uploading-center";
import type { ClipJob } from "@/lib/clipping/types";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import { cn } from "@/lib/utils";

/**
 * The clips produced by the current run (newest job with rendered clips by
 * default; older runs are reachable from the picker). One button books the
 * whole run at the next free slots, with the run's platform picker right beside
 * it; the hashtags and the caption pass sit behind Customise, summarised so what
 * they are set to is readable without opening it. Each card can still be
 * scheduled inline or dragged onto the board.
 */
export function ClipQueue({
  jobs,
  activeJob,
  onSelectJob,
  clips,
  tiktokAccountId,
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
  bookingSummary,
  bookedItems = [],
  onViewBookings,
  onDismissBookingSummary,
  runDefaults,
  onRunDefaultsChange,
  onCaptionsForAll,
  captionsMissing,
  captionProgress,
  captionFailures,
  failedCaptionCount,
  onRetryCaptions,
  targetLabels = PLATFORM_TARGET_LABELS,
  targetHints,
  shortsCap,
  tomorrowKey,
  isSlotUnavailable,
  readOnlyReason,
  timeZone,
  aiCopyAvailable,
  onShowOnBoard,
  isConnected
}: {
  jobs: ClipJob[];
  activeJob: ClipJob | null;
  onSelectJob: (jobId: string) => void;
  clips: ReadyClip[];
  tiktokAccountId: string;
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
  /** What the last bulk booking did; stays until dismissed, because its toast does not. */
  bookingSummary?: { level: "success" | "warning" | "error"; message: string } | null;
  onDismissBookingSummary?: () => void;
  /** The queue posts the last bulk booking made, for "View N bookings" (only those still on the schedule). */
  bookedItems?: QueueItem[];
  /** Scroll the board to those posts and highlight them for a moment. */
  onViewBookings?: (items: QueueItem[]) => void;
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
  /** The platform picker's wording; names the mirror when YouTube is copied to Instagram and Facebook. */
  targetLabels?: Record<PlatformTarget, string>;
  /** What each platform option books, shown under a draft's picker. */
  targetHints?: Record<PlatformTarget, string>;
  /** The shorts-a-day limit and what each day already holds, so the plan stops at it. */
  shortsCap?: ShortsCap;
  /** Tomorrow's date key in the publish timezone, for "from tomorrow". */
  tomorrowKey?: string;
  /** Slot picker filter for the cards: taken slots plus days at the shorts limit. */
  isSlotUnavailable?: (target: PlatformTarget, slotUtc: string) => boolean;
  /** Set while posting is switched off: nothing can be booked, and this says why. */
  readOnlyReason?: string;
  /** The publish zone, for the times on each card. */
  timeZone: string;
  /** Whether a model can write captions (overview.aiCopyAvailable); undefined until known. */
  aiCopyAvailable?: boolean;
  /** Bring a booked clip's post into view on the board. */
  onShowOnBoard?: (item: QueueItem) => void;
  /** Whether a post's account on a platform is connected (the booked row's status words). */
  isConnected?: (platform: PlatformId, accountId: string) => boolean;
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
  // What the click will really book — see `planAutoAssign`. Counted with the
  // failures already known, so it agrees with the warning below it; a caption
  // that fails during the run itself cannot be foreseen here.
  const plan = planAutoAssign({
    clips,
    draftFor,
    isScheduled: (clip) => itemsForClip(clip).length > 0,
    slots,
    isTargetSlotTaken: isSlotTaken,
    skipKeys: new Set(Object.keys(captionFailures)),
    shortsCap
  });
  const bulkLabel = bulkBookingLabel(plan, slots, tomorrowKey);
  const bulkParts = bulkBookingParts(plan, slots, tomorrowKey);
  // The pace under the button's label, with the daily limit it is bound by.
  const bulkSubline = bulkParts?.secondary
    ? `${bulkParts.secondary}${shortsCap ? ` · ${shortsCap.limit} short${shortsCap.limit === 1 ? "" : "s"} a day max` : ""}`
    : null;
  const bulkPrimary = readOnlyReason
    ? "Posting is off"
    : unscheduled === 0
      ? "Every clip here is scheduled"
      : (bulkParts?.primary ?? "Schedule at the next free slots");
  const bulkSecondary = readOnlyReason || unscheduled === 0 ? null : bulkSubline;
  // Read from what the cards will really post: the AI writes hashtags into each
  // caption's last line, so the run defaults alone said "no hashtags" over cards
  // showing ten.
  const unscheduledDrafts = clips.filter((clip) => itemsForClip(clip).length === 0).map(draftFor);
  const hashtagText = hashtagSummary(runHashtags(unscheduledDrafts));
  const captionText = captionSummary(captionsMissing, aiCopyAvailable);
  const optionsSummary = unscheduled === 0 ? "all scheduled" : `${captionText} · ${hashtagText}`;
  return (
    <Card className="min-w-0 space-y-4">
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
          {/* The run's platform sits beside the button it steers: it used to be
              behind Customise, so a whole run went to YouTube without anyone
              having looked at where. */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={runDefaults.platform}
              onChange={(event) =>
                onRunDefaultsChange({ ...runDefaults, platform: event.target.value as PlatformTarget })
              }
              className="h-11 w-auto min-w-28 max-w-full flex-1 basis-44"
              aria-label="Platform for this run"
              title="Where every clip in this run is posted. You can still change a single clip on its card."
            >
              {(Object.keys(targetLabels) as PlatformTarget[]).map((target) => (
                <option key={target} value={target}>
                  {targetLabels[target]}
                </option>
              ))}
            </Select>
            {/* Disabled only when there is genuinely nothing left to book.
                When clips are unscheduled but none can be booked, the press is
                what explains why — a dead button would leave that unsaid. */}
            <Button
              className="h-auto min-h-11 min-w-0 flex-[3] basis-56 py-1.5"
              onClick={onAutoAssign}
              disabled={bulkBusy || unscheduled === 0 || Boolean(readOnlyReason)}
              title={readOnlyReason ?? bulkLabel ?? undefined}
            >
              {autoAssigning ? (
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4 shrink-0" />
              )}
              <span className="flex min-w-0 flex-col items-start text-left leading-tight">
                <span className="max-w-full truncate">{bulkPrimary}</span>
                {bulkSecondary ? (
                  <span className="max-w-full text-[11px] font-normal opacity-80">{bulkSecondary}</span>
                ) : null}
              </span>
            </Button>
          </div>
          {/* Beside the button, not inside it: a link nested in a button is invalid
              and unreachable by keyboard. Same place the board's footer sends to. */}
          {bulkSecondary ? (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              <Link href="/automations#cadence" className="text-[var(--accent)]! underline! underline-offset-2 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
                Change the cadence
              </Link>
            </p>
          ) : null}
          {bookingSummary ? (
            <div
              role="status"
              className={cn(
                "tone-soft tone-edge flex items-start gap-2 rounded-lg border px-2.5 py-2",
                bookingSummary.level === "success" ? "tone-success" : bookingSummary.level === "error" ? "tone-danger" : "tone-warning"
              )}
            >
              {bookingSummary.level === "success" ? (
                <CheckCircle2 className="tone-success tone-text mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <TriangleAlert
                  className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 tone-text", bookingSummary.level === "error" ? "tone-danger" : "tone-warning")}
                />
              )}
              <span
                className={cn(
                  "tone-text min-w-0 flex-1 text-[11px] leading-snug",
                  bookingSummary.level === "success" ? "tone-success" : bookingSummary.level === "error" ? "tone-danger" : "tone-warning"
                )}
              >
                {bookingSummary.message}
                {onViewBookings && bookedItems.length > 0 ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => onViewBookings(bookedItems)}
                      className="font-semibold underline underline-offset-2 hover:opacity-80 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
                    >
                      View {bookedItems.length} booking{bookedItems.length === 1 ? "" : "s"}
                    </button>
                  </>
                ) : null}
              </span>
              {onDismissBookingSummary ? (
                <button
                  type="button"
                  onClick={onDismissBookingSummary}
                  aria-label="Dismiss booking summary"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}
          {plan.capBlocked > 0 && shortsCap ? (
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {plan.capBlocked} clip{plan.capBlocked === 1 ? "" : "s"} won&apos;t fit in this window: every open day
              already holds {shortsCap.limit} short{shortsCap.limit === 1 ? "" : "s"}. Page the calendar forward to
              book {plan.capBlocked === 1 ? "it" : "them"} later.
            </p>
          ) : null}
          <AdvancedOptions id="uploading-center-run" summary={optionsSummary} wrapSummary>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1" />
              <Button
                variant="secondary"
                className="h-9 px-3 text-xs"
                onClick={onCaptionsForAll}
                disabled={bulkBusy}
                title={
                  aiCopyAvailable === false
                    ? "No AI key is set, so each caption becomes the clip's title"
                    : "Write an AI caption for every unscheduled clip in this run that hasn't got one"
                }
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
                  <HashtagChip
                    key={hashtag}
                    hashtag={hashtag}
                    selected={on}
                    toggles
                    onClick={() => toggleHashtag(hashtag)}
                  />
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              These hashtags go on the title of every clip in this run. Changing them here updates the cards below.
            </p>
          </AdvancedOptions>
          {failedCaptionCount > 0 ? (
            <div className="tone-warning tone-edge tone-soft flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2">
              <TriangleAlert className="tone-warning tone-text h-3.5 w-3.5 shrink-0" />
              <span className="tone-warning tone-text min-w-0 flex-1 text-[11px]">
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
          <p className="text-xs text-[var(--muted-foreground)]">
            <Link href="/clips" className="font-medium text-[var(--accent)] underline-offset-2 hover:underline">
              Generate clips
            </Link>{" "}
            first, then schedule them here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {clips.map((clip) => (
            <ClipCard
              key={clip.key}
              clip={clip}
              draft={draftFor(clip)}
              tiktokAccountId={tiktokAccountId}
              slots={slots}
              isSlotTaken={isSlotUnavailable ?? isSlotTaken}
              targetLabels={targetLabels}
              targetHints={targetHints}
              scheduleDisabledReason={readOnlyReason}
              timeZone={timeZone}
              aiCopyAvailable={aiCopyAvailable}
              onShowOnBoard={onShowOnBoard}
              isConnected={isConnected}
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
