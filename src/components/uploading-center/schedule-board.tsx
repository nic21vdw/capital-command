"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ChevronUp, Clapperboard, ExternalLink, Images, Image as ImageIcon, Loader2, Pencil, Plug, RotateCcw, Send, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { YoutubeCardStats } from "@/components/publisher/youtube-stats-line";
import { StatusChip } from "@/components/uploading-center/status-chip";
import { formatClockTime } from "@/lib/timeFormat";
import { CLIP_DRAG_TYPE } from "@/components/uploading-center/clip-card";
import { splitEarlierDays } from "@/components/uploading-center/earlier-days";
import {
  PLATFORM_LABELS,
  primaryAccountIdFor,
  remoteUrlFor,
  studioVideoUrl
} from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import {
  FACEBOOK_SCHEDULED_POSTS_URL,
  UPLOADING_NOW_MESSAGE,
  YOUTUBE_MAY_EXIST_MESSAGE,
  blockedLegControls,
  primaryInlineAction,
  connectLinkLabel,
  legAccountId,
  publishNowSkipped,
  publishNowTargets,
  publishedRemovalNote,
  removalImpact
} from "@/lib/publisher/boardActions";
import { describeFailure, describeWaiting, duplicateTitleCleared } from "@/lib/publisher/failure";
import {
  TIKTOK_INBOX_ACTION,
  isTiktokInboxDraft,
  pastSlotMarker,
  waitingForConnectionHint
} from "@/lib/publisher/nativeScheduling";
import { formatGoLive } from "@/lib/publisher/outcomeCopy";
import { imagePathsOf, imagePostUrl, isImagePost } from "@/lib/publisher/images";
import type { AgendaDay, AgendaEntry } from "@/lib/publisher/agenda";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

/**
 * Day-by-day schedule calendar for one platform. Every scheduled post and every
 * video already on the channel shows on the day it goes live, at its real time —
 * whether it lands on one of the six daily slots (`DEFAULT_SLOT_TIMES` on
 * weekdays, `DEFAULT_WEEKEND_SLOT_TIMES` on weekends) or somewhere in between
 * (a 14:35 upload sits on its day too). The remaining open slots for a day render
 * as drop targets: drop a queue clip, drop a video file straight from the
 * computer, or use the Upload button. Past days keep their history but offer no
 * new slots. This is the whole picture in one place — nothing floats in a list
 * below the calendar anymore.
 */

/** A dropped/picked file counts as video by MIME type or a known extension. */
function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
}

/** The current time, refreshed each minute, so "Retry now" turns from "Retry at slot" while the page sits open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ScheduleBoard({
  platform,
  days,
  thumbnailForItem,
  onDropClip,
  onUploadVideo,
  onSelectSlot,
  onPublishNow,
  onRetry,
  onEditCaption,
  onRemove,
  onRename,
  youtubeQuotaFull,
  isConnected,
  busy,
  highlightedItemId,
  highlightedItemIds,
  shortsPerDay,
  readOnly = false,
  collapseEarlier = false,
  focusDateKey = null,
  onShowEarlier,
  timeZone
}: {
  platform: PlatformId;
  /** Days before today stay behind a "Show earlier days" row until this is false. */
  collapseEarlier?: boolean;
  /** A day something asked to be shown: kept even when it is empty and earlier. */
  focusDateKey?: string | null;
  onShowEarlier?: () => void;
  /** The publish zone, so a slot reads the same in a sentence as on the board. */
  timeZone?: string;
  /** The visible window, one entry per day, already placed and sorted. */
  days: AgendaDay[];
  thumbnailForItem: (item: QueueItem) => string | null;
  onDropClip: (slotUtc: string, clipKey: string) => void;
  /** A video file from the user's computer dropped on (or picked for) a slot. */
  onUploadVideo: (slotUtc: string, file: File) => void;
  /** When set (a clip is being placed), open slots become click targets. */
  onSelectSlot?: (slotUtc: string) => void;
  /** Publish now - asked for confirmation by the card first. */
  onPublishNow: (item: QueueItem, platforms?: PlatformId[]) => void;
  /** Re-queue one platform's failed leg and run it WITHOUT force. */
  onRetry: (item: QueueItem, platform: PlatformId) => void;
  /** Save a new caption on the queued post (the queue only). */
  onEditCaption: (item: QueueItem, caption: string) => void;
  /** Remove the whole post - asked for confirmation by the card first. */
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  /** YouTube's upload allowance for today is spent: posts waiting to upload are waiting for the quota. */
  youtubeQuotaFull?: boolean;
  /**
   * Whether the account a post uses on a platform has a connection. Every card
   * asks it for every leg of its post: a leg on an unconnected account cannot
   * upload or post, so it reads "Waiting for ... connection" rather than
   * "Uploading", is not part of Publish now, and offers Connect, not Retry.
   * Absent means everything counts as connected.
   */
  isConnected?: (platform: PlatformId, accountId: string) => boolean;
  busy: string | null;
  highlightedItemId?: string | null;
  /** More posts to ring at once (the ones a bulk booking just made, while "View bookings" shows them). */
  highlightedItemIds?: string[];
  /** The daily short-form limit, named on days that have reached it. */
  shortsPerDay?: number;
  /** Posting is switched off: the schedule stays visible, but nothing on it can be acted on. */
  readOnly?: boolean;
}) {
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const nowMs = useMinuteClock();
  const { earlier, shown, earlierPosts } = splitEarlierDays(days, collapseEarlier, focusDateKey);

  // One hidden file input for the whole board; the slot whose Upload button
  // opened the picker is remembered so the chosen file lands on it.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSlotRef = useRef<string | null>(null);
  const requestUpload = (slotUtc: string) => {
    uploadSlotRef.current = slotUtc;
    fileInputRef.current?.click();
  };

  return (
    // The calendar grows as tall as it likes and the page's own scroller takes
    // it. It used to bound itself and scroll inside, which put a second
    // scrollbar next to the page's and left the two fighting over the wheel.
    // A disabled fieldset switches off every button and input under it, which is
    // exactly what a read-only board needs without threading a flag through each
    // card. Links (View the video, Studio) stay live.
    <fieldset
      disabled={readOnly}
      className="m-0 block min-w-0 border-0 p-0 [&:disabled_button]:cursor-not-allowed [&:disabled_button]:opacity-50"
    >
    <div className="@container min-w-0 space-y-2 pr-1">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const slotUtc = uploadSlotRef.current;
          uploadSlotRef.current = null;
          if (file && slotUtc) onUploadVideo(slotUtc, file);
        }}
      />
      {earlier.length > 0 ? (
        <button
          type="button"
          onClick={onShowEarlier}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] max-sm:min-h-10"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Show {earlier.length} earlier day{earlier.length === 1 ? "" : "s"} with posts
          {` (${earlierPosts} post${earlierPosts === 1 ? "" : "s"})`}
        </button>
      ) : null}
      {shown.map((day) => (
        <DayBand
          key={day.dateKey}
          platform={platform}
          day={day}
          thumbnailForItem={thumbnailForItem}
          dragOverSlot={dragOverSlot}
          setDragOverSlot={setDragOverSlot}
          onDropClip={onDropClip}
          onUploadVideo={onUploadVideo}
          onRequestUpload={requestUpload}
          onSelectSlot={onSelectSlot}
          onPublishNow={onPublishNow}
          onRetry={onRetry}
          onEditCaption={onEditCaption}
          onRemove={onRemove}
          onRename={onRename}
          youtubeQuotaFull={youtubeQuotaFull}
          isConnected={isConnected}
          nowMs={nowMs}
          busy={busy}
          highlightedItemId={highlightedItemId}
          highlightedItemIds={highlightedItemIds}
          timeZone={timeZone}
          shortsPerDay={shortsPerDay}
        />
      ))}
    </div>
    </fieldset>
  );
}

/** One day: its date on the left, everything happening that day on the right. */
function DayBand({
  platform,
  day,
  thumbnailForItem,
  dragOverSlot,
  setDragOverSlot,
  onDropClip,
  onUploadVideo,
  onRequestUpload,
  onSelectSlot,
  onPublishNow,
  onRetry,
  onEditCaption,
  onRemove,
  onRename,
  youtubeQuotaFull,
  isConnected,
  nowMs,
  busy,
  highlightedItemId,
  highlightedItemIds,
  timeZone,
  shortsPerDay
}: {
  platform: PlatformId;
  day: AgendaDay;
  thumbnailForItem: (item: QueueItem) => string | null;
  dragOverSlot: string | null;
  setDragOverSlot: (id: string | null) => void;
  onDropClip: (slotUtc: string, clipKey: string) => void;
  onUploadVideo: (slotUtc: string, file: File) => void;
  onRequestUpload: (slotUtc: string) => void;
  onSelectSlot?: (slotUtc: string) => void;
  onPublishNow: (item: QueueItem, platforms?: PlatformId[]) => void;
  onRetry: (item: QueueItem, platform: PlatformId) => void;
  onEditCaption: (item: QueueItem, caption: string) => void;
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  youtubeQuotaFull?: boolean;
  isConnected?: (platform: PlatformId, accountId: string) => boolean;
  nowMs: number;
  busy: string | null;
  highlightedItemId?: string | null;
  highlightedItemIds?: string[];
  timeZone?: string;
  shortsPerDay?: number;
}) {
  const { today, past, entries, openSlots, shortsFull } = day;
  const empty = entries.length === 0 && openSlots.length === 0 && !shortsFull;
  return (
    <div
      id={`agenda-day-${day.dateKey}`}
      className={cn(
        "grid min-w-0 scroll-mt-2 grid-cols-1 gap-3 rounded-xl border p-2.5 @min-[480px]:grid-cols-[6.5rem_minmax(0,1fr)]",
        today ? "border-[var(--accent)]/40 bg-[var(--accent)]/5" : "border-[var(--border)]",
        past && !today && "opacity-80"
      )}
    >
      <div className="flex flex-wrap items-center gap-2 pt-1 @min-[480px]:flex-col @min-[480px]:items-start @min-[480px]:gap-1">
        <span className={cn("text-xs font-semibold text-white", today && "text-[var(--accent)]")}>{day.dateLabel}</span>
        {today ? (
          <span className="w-fit rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            Today
          </span>
        ) : null}
        {entries.length > 0 ? (
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {entries.length} post{entries.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(13.5rem,100%),1fr))]">
        {entries.map((entry) =>
          entry.kind === "queue" ? (
            <QueueEntryCard
              key={`q:${entry.item.id}`}
              platform={platform}
              time={formatClockTime(entry.time)}
              item={entry.item}
              thumbnailForItem={thumbnailForItem}
              today={today}
              onPublishNow={onPublishNow}
              onRetry={onRetry}
              onEditCaption={onEditCaption}
              onRemove={onRemove}
              onRename={onRename}
              youtubeQuotaFull={youtubeQuotaFull}
              isConnected={isConnected}
              nowMs={nowMs}
              busy={busy}
              highlighted={highlightedItemId === entry.item.id || Boolean(highlightedItemIds?.includes(entry.item.id))}
              timeZone={timeZone}
            />
          ) : (
            <ChannelEntryCard key={`c:${entry.video.videoId}`} time={formatClockTime(entry.time)} entry={entry} today={today} />
          )
        )}
        {openSlots.map((slot) => (
          <OpenSlotCard
            key={slot.id}
            platform={platform}
            slot={slot}
            today={today}
            dragOverSlot={dragOverSlot}
            setDragOverSlot={setDragOverSlot}
            onDropClip={onDropClip}
            onUploadVideo={onUploadVideo}
            onRequestUpload={onRequestUpload}
            onSelectSlot={onSelectSlot}
            busy={busy}
          />
        ))}
        {shortsFull ? (
          <div
            className="flex min-h-14 flex-col justify-center rounded-lg border border-dashed border-[var(--border)] px-3 text-[11px] text-[var(--muted-foreground)]"
            title="Each day takes a limited number of short videos. Pick another day."
          >
            <span className="font-medium text-white">
              Day full{shortsPerDay ? ` (${shortsPerDay} shorts)` : ""}
            </span>
            <span>No more shorts can be booked here. Pick another day.</span>
          </div>
        ) : null}
        {empty ? (
          <div className="flex min-h-14 items-center rounded-lg border border-dashed border-[var(--border)] px-3 text-[11px] text-[var(--muted-foreground)] opacity-60">
            {/* Today never offers a slot — nothing is scheduled for the day it
                is booked (src/lib/publisher/schedule.ts) — so say that rather
                than letting the day read as a full calendar. */}
            {today
              ? "Nothing books onto today — the earliest slot is tomorrow"
              : past
                ? "No posts this day"
                : "No open slots"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A scheduled/queued post of ours — editable, with publish/remove actions. */
function QueueEntryCard({
  platform,
  time,
  item,
  thumbnailForItem,
  today,
  onPublishNow,
  onRetry,
  onEditCaption,
  onRemove,
  onRename,
  youtubeQuotaFull,
  isConnected,
  nowMs,
  busy,
  highlighted,
  timeZone
}: {
  platform: PlatformId;
  time: string;
  item: QueueItem;
  thumbnailForItem: (item: QueueItem) => string | null;
  today: boolean;
  onPublishNow: (item: QueueItem, platforms?: PlatformId[]) => void;
  onRetry: (item: QueueItem, platform: PlatformId) => void;
  onEditCaption: (item: QueueItem, caption: string) => void;
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  youtubeQuotaFull?: boolean;
  isConnected?: (platform: PlatformId, accountId: string) => boolean;
  nowMs: number;
  busy: string | null;
  highlighted?: boolean;
  timeZone?: string;
}) {
  const state = item.platforms[platform] as PlatformState;
  const slotLabel = formatGoLive(item.publishAt, timeZone);
  // Whether the account this post uses on each platform has a connection. A
  // pending leg on one that does not is not "uploading": nothing can go until
  // it is connected.
  const legConnected = (leg: PlatformId) => (isConnected ? isConnected(leg, legAccountId(item, leg)) : true);
  const connected = legConnected(platform);
  const url = remoteUrlFor(platform, state.postId);
  const thumbnailUrl = thumbnailForItem(item);
  // "failed" and "manual" are terminal until something un-blocks them, so the
  // send button re-arms the post first; the rest go straight out.
  const blocked = state.status === "failed" || state.status === "manual";
  const advice = blocked
    ? describeFailure(state, platform, {
        publishAt: item.publishAt,
        when: slotLabel,
        now: new Date(nowMs),
        connected
      })
    : null;
  // A leg that is not failed but is not simply waiting: an error on record or a
  // later attempt booked. Without this line it reads exactly like a healthy one.
  const waiting = blocked ? null : describeWaiting(state, platform);
  const quotaWait = platform === "youtube" && state.status === "pending" && !state.postId && Boolean(youtubeQuotaFull);
  const inboxDraft = isTiktokInboxDraft(platform, state.status, item);
  const awaitingConnection = state.status === "pending" && !connected;
  // A slot that passed with the post still pending (or still "scheduled" on a platform
  // that should have published it): the chip says so, and this line says what to do.
  const pastSlot = pastSlotMarker(platform, state, item, new Date(nowMs), {
    connected: state.status === "pending" ? connected : undefined,
    youtubeQuotaFull: quotaWait
  });
  const waitingLine = awaitingConnection
    ? waitingForConnectionHint(platform, slotLabel)
    : waiting
    ? state.nextAttemptAt
      ? `Retrying at ${formatGoLive(state.nextAttemptAt, timeZone)} - ${waiting.headline}`
      : `Will retry - ${waiting.headline}`
    : quotaWait
      ? "YouTube's upload limit for today is used up. This goes up after the quota resets, nothing is lost."
      : inboxDraft
        ? `${TIKTOK_INBOX_ACTION} - it is not live until you do.`
        : (pastSlot?.hint ?? null);
  const detailRaw = advice?.raw ?? waiting?.raw;
  // Publish now also reaches a post YouTube/Facebook is holding for its slot
  // (status "scheduled"): that is the case where it makes the post public now.
  // It only sends legs whose account is connected - the others stay waiting -
  // and is not offered at all when none is.
  const targets = publishNowTargets(item);
  const sendable = publishNowTargets(item, legConnected);
  const skipped = publishNowSkipped(item, legConnected);
  // A duplicate-title refusal is answered by retitling. Once the post carries a
  // different title than the one the channel refused, Retry is the next step.
  const retitled = advice?.kind === "duplicate-title" && duplicateTitleCleared(state.error, item.title);
  // CONNECTION STATE WINS over the kind of error (see blockedLegControls): a
  // leg on an account that is not connected is never offered Retry.
  const controls = advice ? blockedLegControls(advice, { connected, retitled }) : null;
  const needsRename = Boolean(controls?.rename);
  const actionable = blocked ? Boolean(controls?.retry) : targets.includes(platform) && sendable.length > 0;
  const working = busy === `publish:${item.id}` || busy === `remove:${item.id}`;
  // A picture post has no poster frame — its own first slide IS the thumbnail,
  // served by position out of the queue so the card can reach files that live
  // under data/ and never appear in a URL.
  const pictures = isImagePost(item) ? imagePathsOf(item).length : 0;
  const [showSlides, setShowSlides] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "remove" | null>(null);
  const [editingCaption, setEditingCaption] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(item.caption ?? "");
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const captionButtonRef = useRef<HTMLButtonElement>(null);
  // Opening the editor puts the cursor at the end of the caption, ready to type:
  // the box used to appear below the buttons with focus still on the button.
  useEffect(() => {
    if (!editingCaption) return;
    const box = captionRef.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [editingCaption]);
  const canSaveCaption = captionDraft.trim() !== "" && captionDraft.trim() !== (item.caption ?? "").trim();
  // Closing hands focus back to the button that opened the editor, so a
  // keyboard user is not dropped at the top of the page.
  const closeCaptionEditor = () => {
    setEditingCaption(false);
    captionButtonRef.current?.focus();
  };
  const slotPassed = new Date(item.publishAt).getTime() <= nowMs;
  const retryLabel = slotPassed ? "Retry now" : "Retry at slot";
  const retryHint = slotPassed
    ? `Put ${PLATFORM_LABELS[platform]} back in the queue and post it now. The post's other platforms are not touched.`
    : `Put ${PLATFORM_LABELS[platform]} back in the queue. It posts at its slot (${time}); the post's other platforms are not touched.`;
  // Connect when nothing was ever set up, Reconnect when credentials existed and
  // lapsed. A leg whose account has been connected since needs no link at all
  // unless the credentials themselves are stale.
  const connectVerb = controls?.connect ?? "Connect";
  // Beside Rename on a refused title the link says it is only there for Retry.
  const connectText =
    (controls ? connectLinkLabel(controls, advice, PLATFORM_LABELS[platform]) : null) ??
    `${connectVerb} ${PLATFORM_LABELS[platform]}`;
  const showConnect = controls ? controls.connect !== null : awaitingConnection;
  // The filled button is the one that fixes THIS failure (see primaryInlineAction).
  const primaryAction = controls ? primaryInlineAction(controls) : showConnect ? "connect" : null;
  const connectClass = primaryAction === "connect" ? INLINE_ACTION_PRIMARY : INLINE_ACTION_SECONDARY;
  const everyLegPublished = Object.values(item.platforms).every((leg) => leg?.status === "published");
  const youtubeVideoId = item.platforms.youtube?.postId;

  const send = () => {
    if (blocked) onRetry(item, platform);
    else setConfirm("publish");
  };
  // What the failure line says. A retry-able error on an account that is not
  // connected gets the reason Retry is missing, so its absence is not a mystery.
  const headline =
    advice && controls?.needsConnection && advice.kind === "retryable"
      ? `${advice.headline} Connect ${PLATFORM_LABELS[platform]} first - retrying without it would only fail again.`
      : (advice?.headline ?? "");
  const impact = removalImpact(item, { now: new Date(nowMs) });
  const labelList = (platforms: PlatformId[]) => {
    const names = platforms.map((id) => PLATFORM_LABELS[id]);
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };
  return (
    <div
      id={`queue-item-${item.id}`}
      className={cn(
        "flex min-h-16 gap-2 rounded-lg border border-[var(--border-strong)] bg-white/6 p-2",
        today && "border-[var(--accent)]/40",
        highlighted && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--background)]"
      )}
      title={advice ? headline : item.title}
    >
      {pictures > 0 ? (
        <a
          href={imagePostUrl(item.id, 0)}
          target="_blank"
          rel="noreferrer"
          title={pictures > 1 ? `Open slide 1 of ${pictures}` : "Open the picture"}
          className="relative block h-14 w-8 shrink-0 overflow-hidden max-sm:w-10 rounded-md border border-[var(--border)] bg-black/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route, not a next/image loader */}
          {/* Contain, not cover: a slide is copy, and a crop of it is unreadable. */}
          <img src={imagePostUrl(item.id, 0)} alt="" loading="lazy" className="h-full w-full object-contain" />
          <span className="absolute bottom-0 right-0 flex items-center gap-0.5 rounded-tl-md bg-black/70 px-1 py-0.5 text-[8px] font-semibold text-white">
            {pictures > 1 ? <Images className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
            {pictures}
          </span>
        </a>
      ) : thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local clip frame, not a remote asset in next.config images
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-14 w-8 shrink-0 rounded-md border border-[var(--border)] object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        {/* While renaming, the editor takes the whole row and the time steps aside:
            beside the time it left about twenty of the fifty characters visible. */}
        <div className={cn("flex gap-1.5", renaming ? "flex-wrap" : "items-baseline")}>
          <EditableTitle
            title={item.title}
            editing={renaming}
            onEditingChange={setRenaming}
            onRename={(title) => onRename(item, title)}
          />
          {renaming ? null : (
            <span className="ml-auto shrink-0 text-[10px] font-medium text-[var(--muted-foreground)]">{time}</span>
          )}
        </div>
        {platform === "youtube" && state.status === "published" && state.postId ? (
          <YoutubeCardStats itemId={item.id} videoId={state.postId} />
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          <StatusChip
            status={state.status}
            platform={platform}
            item={item}
            youtubeQuotaFull={quotaWait}
            connected={state.status === "pending" || state.status === "manual" ? connected : undefined}
            slotLabel={slotLabel}
            leg={state}
            className="max-w-full shrink-0 whitespace-normal!"
          />
          {state.mirroredFrom ? (
            <span
              title={`Added automatically: ${PLATFORM_LABELS[state.mirroredFrom]}'s schedule is copied onto this platform.`}
              className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              Mirrored from {PLATFORM_LABELS[state.mirroredFrom]}
            </span>
          ) : null}
          {pictures > 0 ? (
            <button
              type="button"
              onClick={() => setShowSlides((shown) => !shown)}
              title={showSlides ? "Hide the files" : "Show every slide file"}
              className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] transition hover:bg-white/20 hover:text-white max-sm:min-h-10 max-sm:px-3"
            >
              {pictures > 1 ? `Carousel · ${pictures}` : "Image"}
            </button>
          ) : null}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label="View the video"
              title="View the video"
              className="flex shrink-0 items-center justify-center text-[var(--accent)] max-sm:h-10 max-sm:w-10"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {platform === "youtube" && state.postId ? (
            <a
              href={studioVideoUrl(state.postId)}
              target="_blank"
              rel="noreferrer"
              aria-label="Edit in YouTube Studio"
              title="Edit in YouTube Studio (title, description…)"
              className="flex shrink-0 items-center justify-center text-[var(--accent)] max-sm:h-10 max-sm:w-10"
            >
              <Clapperboard className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <span className="flex-1" />
          {working ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
          ) : (
            <>
              {!everyLegPublished ? (
                <button
                  ref={captionButtonRef}
                  type="button"
                  onClick={() => {
                    setCaptionDraft(item.caption ?? "");
                    setEditingCaption((open) => !open);
                  }}
                  aria-label="Edit caption"
                  title="Edit the caption of the queued post"
                  className={cn(ACTION_BUTTON, editingCaption && "text-white")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Caption
                </button>
              ) : null}
              {actionable ? (
                <button
                  type="button"
                  onClick={send}
                  aria-label={blocked ? retryLabel : "Publish now"}
                  title={blocked ? retryHint : "Publish this post to all its unfinished platforms right now"}
                  className={cn(
                    ACTION_BUTTON,
                    blocked &&
                      (state.status === "failed"
                        ? "hover:text-[var(--danger)] text-[var(--danger)]"
                        : "hover:text-[var(--warning)] text-[var(--warning)]")
                  )}
                >
                  {blocked ? <RotateCcw className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                  {blocked ? retryLabel : "Publish now"}
                </button>
              ) : null}
              {/* A post that is live everywhere has nothing to cancel, and the queue's
                  record of it is what stops the channel scan taking it back in as new. */}
              {!everyLegPublished ? (
              <button
                type="button"
                onClick={() => setConfirm("remove")}
                aria-label="Remove post from every platform"
                title="Remove this post from the schedule on every platform"
                className={cn(ACTION_BUTTON, "hover:text-[var(--danger)]")}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
              ) : null}
            </>
          )}
        </div>
        {editingCaption ? (
          <div className="mt-1.5 space-y-1">
            <Textarea
              ref={captionRef}
              value={captionDraft}
              onChange={(event) => setCaptionDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeCaptionEditor();
                } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (!canSaveCaption) return;
                  onEditCaption(item, captionDraft);
                  closeCaptionEditor();
                }
              }}
              aria-label="Caption"
              rows={3}
              className="min-h-16 px-2 py-1.5 text-xs"
            />
            {(item.hashtags ?? []).length > 0 ? (
              <p className="text-[10px] text-[var(--muted-foreground)]">Hashtags added after it: {item.hashtags.join(" ")}</p>
            ) : null}
            <p className="text-[10px] leading-snug text-[var(--muted-foreground)]">
              Changes the queued post.{" "}
              {youtubeVideoId ? (
                <>
                  YouTube&apos;s description is not changed -{" "}
                  <a
                    href={studioVideoUrl(youtubeVideoId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    edit it in YouTube Studio
                  </a>
                  .
                </>
              ) : null}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                className="h-7 px-2.5 text-[11px]"
                disabled={!canSaveCaption}
                title="Save (Ctrl or Cmd + Enter)"
                onClick={() => {
                  onEditCaption(item, captionDraft);
                  closeCaptionEditor();
                }}
              >
                Save caption
              </Button>
              <Button variant="ghost" className="h-7 px-2.5 text-[11px]" title="Cancel (Esc)" onClick={closeCaptionEditor}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {showSlides && pictures > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-[var(--muted-foreground)]">Rendered and ready:</span>
            {Array.from({ length: pictures }, (_, index) => (
              <a
                key={index}
                href={imagePostUrl(item.id, index, { download: true })}
                download
                title={`Download slide ${index + 1}`}
                className="inline-flex items-center justify-center rounded-md border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 max-sm:min-h-10 max-sm:min-w-10"
              >
                {index + 1}
              </a>
            ))}
          </div>
        ) : null}
        {advice || waitingLine ? (
          <div className="mt-1 space-y-1">
            <p
              className={cn(
                "text-[11px] leading-snug",
                advice && state.status === "failed" ? "tone-danger tone-text" : "tone-warning tone-text"
              )}
            >
              {retitled
                ? `Renamed to "${item.title}". ${
                    controls?.needsConnection
                      ? `Connect ${PLATFORM_LABELS[platform]}, then retry to post it.`
                      : slotPassed
                        ? "Retry now to post it."
                        : `Retry at slot to post it at ${time}.`
                  }`
                : (advice ? headline : waitingLine)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* The filled button is the one that fixes THIS failure: Rename for a refused
                  title (Connect is only there so the retry can work), Connect when the
                  connection is what is missing. */}
              {showConnect && platform === "youtube" ? (
                <a
                  href={`/api/auth/google?account=${encodeURIComponent(item.accountId ?? primaryAccountIdFor("youtube"))}`}
                  className={connectClass}
                >
                  <Plug className="h-3 w-3" /> {connectText}
                </a>
              ) : null}
              {showConnect && platform !== "youtube" ? (
                <Link href="/settings#accounts" className={connectClass}>
                  <Plug className="h-3 w-3" /> {connectText}
                </Link>
              ) : null}
              {needsRename ? (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  title={
                    controls?.needsConnection
                      ? "Give the post a new title. It can be retried once the account is connected"
                      : "Give the post a new title, then retry it"
                  }
                  className={cn(
                    primaryAction === "rename" ? INLINE_ACTION_PRIMARY : showConnect ? INLINE_ACTION_SECONDARY : INLINE_ACTION,
                    primaryAction === "rename" && "order-first"
                  )}
                >
                  <Pencil className="h-3 w-3" /> {controls?.needsConnection ? "Rename" : "Rename and retry"}
                </button>
              ) : null}
              {pastSlot?.kind === "overdue" ? (
                <Link href={pastSlot.href} className={INLINE_ACTION}>
                  {pastSlot.linkLabel}
                </Link>
              ) : null}
              {pastSlot?.kind === "should-be-live" && remoteUrlFor(platform, state.postId, state.status) ? (
                <a
                  href={remoteUrlFor(platform, state.postId, state.status) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={INLINE_ACTION}
                >
                  <ExternalLink className="h-3 w-3" /> {pastSlot.linkLabel}
                </a>
              ) : null}
              {detailRaw ? (
                <button
                  type="button"
                  onClick={() => setShowRaw((shown) => !shown)}
                  className="text-[11px] font-medium text-[var(--muted-foreground)] underline-offset-2 transition hover:text-white hover:underline max-sm:min-h-10 max-sm:px-2"
                >
                  {showRaw ? "Hide details" : "Details"}
                </button>
              ) : null}
            </div>
            {showRaw && detailRaw ? (
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-1.5 text-[10px] leading-snug text-[var(--muted-foreground)]">
                {detailRaw}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
      {confirm === "publish" ? (
        <ConfirmDialog
          title="Publish now?"
          description={`Publish "${item.title}" to ${labelList(sendable) || PLATFORM_LABELS[platform]} now?`}
          confirmLabel="Publish now"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onPublishNow(item, skipped.length > 0 ? sendable : undefined);
          }}
        >
          {skipped.length > 0 ? (
            <p className="tone-warning tone-text">
              {labelList(skipped)} {skipped.length === 1 ? "is" : "are"} not connected, so{" "}
              {skipped.length === 1 ? "it stays" : "they stay"} waiting. Connect {skipped.length === 1 ? "it" : "them"} in
              Settings to post {skipped.length === 1 ? "it" : "them"} too.
            </p>
          ) : null}
          <p>
            This does not wait for the slot ({time}). Every platform above that has not finished posts immediately
            {sendable.includes("youtube") ? ", and a YouTube video held for its slot is made public right away" : ""}.
          </p>
        </ConfirmDialog>
      ) : null}
      {confirm === "remove" ? (
        <ConfirmDialog
          title="Remove from the schedule?"
          description={`Remove "${item.title}" from ${labelList(impact.platforms)}? Remove covers the whole post, not just this tab.`}
          confirmLabel={impact.platforms.length > 1 ? "Remove from all" : "Remove"}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onRemove(item);
          }}
        >
          {impact.uploading ? <p className="tone-warning tone-text">{UPLOADING_NOW_MESSAGE}</p> : null}
          {impact.youtubeMayExist ? (
            <p className="tone-warning tone-text">
              {YOUTUBE_MAY_EXIST_MESSAGE}{" "}
              <a
                href="https://studio.youtube.com"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Open YouTube Studio
              </a>
            </p>
          ) : null}
          {impact.youtube ? (
            <p>
              YouTube already has this video and would publish it at {time}. Removing keeps it private on your channel;
              it is not deleted.{" "}
              <a
                href={studioVideoUrl(impact.youtube.postId)}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Open in YouTube Studio
              </a>
            </p>
          ) : null}
          {impact.facebook ? (
            <p className="tone-warning tone-text">
              Facebook already holds this post and will still publish it at {time}. Facebook posts cannot be cancelled
              from here.{" "}
              <a
                href={FACEBOOK_SCHEDULED_POSTS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Cancel it in Meta Business Suite
              </a>
            </p>
          ) : null}
          {impact.published.length > 0 ? <p>{publishedRemovalNote(impact.published, PLATFORM_LABELS)}</p> : null}
          {impact.published.length === 0 &&
          !impact.youtube &&
          !impact.facebook &&
          !impact.youtubeMayExist &&
          !impact.uploading ? (
            <p>Nothing has gone up yet, so nothing is left on any platform.</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** The accent-outlined action under a card's failure line (Rename and retry, Connect TikTok, ...). */
const INLINE_ACTION =
  "inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/50 px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 max-sm:min-h-10 max-sm:px-3";

/** The one action that unblocks a card (Connect YouTube to retry): filled, so it reads first. */
const INLINE_ACTION_PRIMARY =
  "inline-flex items-center gap-1 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-contrast)] transition hover:bg-[var(--accent-strong)] max-sm:min-h-10 max-sm:px-3";

/** The quieter action beside the primary fix (Rename next to Connect): same shape, no accent. */
const INLINE_ACTION_SECONDARY =
  "inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:bg-white/8 hover:text-white max-sm:min-h-10 max-sm:px-3";

/** The text-labelled action buttons on a post card. */
const ACTION_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:bg-white/8 hover:text-white max-sm:min-h-10 max-sm:px-2.5";

/**
 * A confirmation for an action that cannot be taken back from the board. It is
 * portalled to the page: a past day's band is dimmed with opacity, which makes
 * it a stacking context, and a dialog left inside it could sit under the next
 * band.
 */
function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
  children
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  return createPortal(
    <Modal open title={title} description={description} onClose={onCancel}>
      <div className="space-y-2 text-sm text-[var(--muted-foreground)]">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        {/* A destructive question opens on its safe answer: Enter on a dialog that
            just appeared should never be the one that removes the post. */}
        <Button variant="ghost" onClick={onCancel} autoFocus={danger}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} autoFocus={!danger}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>,
    document.body
  );
}

/** A video already on the channel (scheduled in Studio or published) — read-only. */
function ChannelEntryCard({
  time,
  entry,
  today
}: {
  time: string;
  entry: Extract<AgendaEntry, { kind: "channel" }>;
  today: boolean;
}) {
  const { video } = entry;
  return (
    <div
      className={cn(
        "flex min-h-16 flex-col rounded-lg border border-[var(--border-strong)] bg-white/6 p-2",
        today && "border-[var(--accent)]/40"
      )}
      title={video.title}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">{video.title}</span>
        <span className="ml-auto shrink-0 text-[10px] font-medium text-[var(--muted-foreground)]">{time}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <StatusChip status={video.status} />
        <a
          href={video.url}
          target="_blank"
          rel="noreferrer"
          aria-label="View the video"
          title="View the video"
          className="flex items-center justify-center text-[var(--accent)] max-sm:h-10 max-sm:w-10"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href={studioVideoUrl(video.videoId)}
          target="_blank"
          rel="noreferrer"
          aria-label="Edit in YouTube Studio"
          title="Edit in YouTube Studio (title, description…)"
          className="flex items-center justify-center text-[var(--accent)] max-sm:h-10 max-sm:w-10"
        >
          <Clapperboard className="h-3.5 w-3.5" />
        </a>
        <span className="flex-1" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">On YouTube</span>
      </div>
    </div>
  );
}

/** An open future slot: a drop target / one-click placement / upload picker. */
function OpenSlotCard({
  platform,
  slot,
  today,
  dragOverSlot,
  setDragOverSlot,
  onDropClip,
  onUploadVideo,
  onRequestUpload,
  onSelectSlot,
  busy
}: {
  platform: PlatformId;
  slot: ScheduleSlot;
  today: boolean;
  dragOverSlot: string | null;
  setDragOverSlot: (id: string | null) => void;
  onDropClip: (slotUtc: string, clipKey: string) => void;
  onUploadVideo: (slotUtc: string, file: File) => void;
  onRequestUpload: (slotUtc: string) => void;
  onSelectSlot?: (slotUtc: string) => void;
  busy: string | null;
}) {
  const uploading = busy === `upload:${platform}:${slot.utc}`;
  if (uploading) {
    return (
      <div className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--accent)]/50 bg-[var(--accent)]/5 text-[11px] text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
        Uploading…
      </div>
    );
  }
  if (onSelectSlot) {
    // Placement mode (arriving from the editor's Schedule Short): every open
    // slot is a one-click target for the pre-selected clip.
    return (
      <button
        type="button"
        onClick={() => onSelectSlot(slot.utc)}
        className={cn(
          "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-[var(--accent)]/50 bg-[var(--accent)]/5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 hover:text-white",
          today && "border-[var(--accent)]/70"
        )}
      >
        <span className={cn("text-[10px]", today && "font-medium text-[var(--accent)]")}>{formatClockTime(slot.time)}</span>
        Schedule here
      </button>
    );
  }
  return (
    <div
      onDragOver={(event) => {
        // Accept a clip card from the queue or a video file dragged in from the
        // computer (file drags expose only the "Files" type).
        const types = event.dataTransfer.types;
        if (!types.includes(CLIP_DRAG_TYPE) && !types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOverSlot(slot.id);
      }}
      onDragLeave={() => setDragOverSlot(null)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOverSlot(null);
        const clipKey = event.dataTransfer.getData(CLIP_DRAG_TYPE);
        if (clipKey) {
          onDropClip(slot.utc, clipKey);
          return;
        }
        const file = Array.from(event.dataTransfer.files).find(isVideoFile);
        if (file) onUploadVideo(slot.utc, file);
        else if (event.dataTransfer.files.length > 0) toast.error("Drop a video file (MP4, MOV, WebM…).");
      }}
      className={cn(
        "group flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-[var(--border)] text-[11px] text-[var(--muted-foreground)] transition",
        today && "border-[var(--accent)]/50 bg-[var(--accent)]/5",
        dragOverSlot === slot.id && "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
      )}
    >
      <span className={cn("text-[10px]", today && "font-medium text-[var(--accent)]")}>{formatClockTime(slot.time)}</span>
      Drop a clip or video
      <button
        type="button"
        onClick={() => onRequestUpload(slot.utc)}
        className="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] opacity-70 transition hover:bg-[var(--accent)]/10 hover:opacity-100 max-sm:min-h-10 max-sm:px-3"
      >
        <Upload className="h-3 w-3" /> Upload clip
      </button>
    </div>
  );
}

/**
 * The clip's title on a filled slot, editable in place: click the title or its
 * pencil to edit, Enter or blur commits (which renames the video on YouTube too
 * when it's already up), Escape cancels. Capped at YouTube's 100-character title
 * limit. The card owns `editing` so its own "Rename and retry" can open it too.
 *
 * The pencil is always drawn: it only appeared on hover, so on touch (and for
 * anyone who had not hovered the title) nothing said the title could be changed.
 */
function EditableTitle({
  title,
  editing,
  onEditingChange,
  onRename
}: {
  title: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (title: string) => void;
}) {
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => onEditingChange(true)}
        aria-label="Rename video"
        title="Rename"
        className="group flex min-w-0 flex-1 items-center gap-1 rounded text-left max-sm:min-h-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <span className="min-w-0 truncate text-xs font-medium text-white">{title}</span>
        <span className="inline-flex shrink-0 items-center rounded p-0.5 text-[var(--muted-foreground)] transition group-hover:bg-white/10 group-hover:text-white group-focus-visible:text-white">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>
    );
  }

  return <TitleInput title={title} onDone={() => onEditingChange(false)} onRename={onRename} />;
}

/**
 * Mounted only while editing, so every edit starts from the title as it is now.
 *
 * Enter and the check button save, Escape and the cross cancel, and the hint
 * under the field says so: the field alone gave no sign how to finish. Leaving
 * the field still saves (as it always did). The buttons keep the input focused
 * on press (preventDefault on mousedown) so pressing one is not first a blur
 * that saves and unmounts the field before the click lands.
 */
function TitleInput({ title, onDone, onRename }: { title: string; onDone: () => void; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState(title);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Grows with what is typed, so the whole title is always in view; Enter still
  // saves, so it never holds a line break.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [draft]);
  const commit = () => {
    onDone();
    const trimmed = draft.replace(/\s+/g, " ").trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
  };
  const cancel = () => {
    setDraft(title);
    onDone();
  };
  return (
    <div className="min-w-0 basis-full">
      <textarea
        ref={fieldRef}
        autoFocus
        rows={2}
        value={draft}
        maxLength={100}
        onChange={(event) => setDraft(event.target.value.replace(/\r?\n/g, " "))}
        onFocus={(event) => event.target.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            cancel();
          }
        }}
        aria-label="Video title"
        className="block w-full min-w-0 resize-none rounded border border-[var(--accent)]/50 bg-[var(--well-deep)] px-1.5 py-1 text-xs font-medium leading-snug text-white outline-none"
      />
      <div className="mt-0.5 flex items-center gap-1">
        <p className="min-w-0 flex-1 text-[10px] leading-snug text-[var(--muted-foreground)]">
          Enter to save · Esc to cancel
        </p>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={commit}
          aria-label="Save title"
          title="Save the new title (Enter)"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded max-sm:h-10 max-sm:w-10 text-[var(--success)] transition hover:bg-white/10"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={cancel}
          aria-label="Cancel renaming"
          title="Keep the old title (Esc)"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded max-sm:h-10 max-sm:w-10 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
