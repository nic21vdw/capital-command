"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Clapperboard, ExternalLink, Images, Image as ImageIcon, Loader2, Pencil, Plug, RotateCcw, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/uploading-center/status-chip";
import { CLIP_DRAG_TYPE } from "@/components/uploading-center/clip-card";
import {
  PLATFORM_LABELS,
  primaryAccountIdFor,
  remoteUrlFor,
  studioVideoUrl
} from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import { FACEBOOK_SCHEDULED_POSTS_URL, publishNowTargets, removalImpact } from "@/lib/publisher/boardActions";
import { describeFailure, describeWaiting } from "@/lib/publisher/failure";
import { TIKTOK_INBOX_ACTION, isTiktokInboxDraft } from "@/lib/publisher/nativeScheduling";
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
  busy,
  highlightedItemId
}: {
  platform: PlatformId;
  /** The visible window, one entry per day, already placed and sorted. */
  days: AgendaDay[];
  thumbnailForItem: (item: QueueItem) => string | null;
  onDropClip: (slotUtc: string, clipKey: string) => void;
  /** A video file from the user's computer dropped on (or picked for) a slot. */
  onUploadVideo: (slotUtc: string, file: File) => void;
  /** When set (a clip is being placed), open slots become click targets. */
  onSelectSlot?: (slotUtc: string) => void;
  /** Publish now - asked for confirmation by the card first. */
  onPublishNow: (item: QueueItem) => void;
  /** Re-queue one platform's failed leg and run it WITHOUT force. */
  onRetry: (item: QueueItem, platform: PlatformId) => void;
  /** Save a new caption on the queued post (the queue only). */
  onEditCaption: (item: QueueItem, caption: string) => void;
  /** Remove the whole post - asked for confirmation by the card first. */
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  /** YouTube's upload allowance for today is spent: posts waiting to upload are waiting for the quota. */
  youtubeQuotaFull?: boolean;
  busy: string | null;
  highlightedItemId?: string | null;
}) {
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const nowMs = useMinuteClock();

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
      {days.map((day) => (
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
          nowMs={nowMs}
          busy={busy}
          highlightedItemId={highlightedItemId}
        />
      ))}
    </div>
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
  nowMs,
  busy,
  highlightedItemId
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
  onPublishNow: (item: QueueItem) => void;
  onRetry: (item: QueueItem, platform: PlatformId) => void;
  onEditCaption: (item: QueueItem, caption: string) => void;
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  youtubeQuotaFull?: boolean;
  nowMs: number;
  busy: string | null;
  highlightedItemId?: string | null;
}) {
  const { today, past, entries, openSlots } = day;
  const empty = entries.length === 0 && openSlots.length === 0;
  return (
    <div
      id={`agenda-day-${day.dateKey}`}
      className={cn(
        "grid min-w-0 grid-cols-1 gap-3 rounded-xl border p-2.5 @min-[480px]:grid-cols-[6.5rem_minmax(0,1fr)]",
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
              time={entry.time}
              item={entry.item}
              thumbnailForItem={thumbnailForItem}
              today={today}
              onPublishNow={onPublishNow}
              onRetry={onRetry}
              onEditCaption={onEditCaption}
              onRemove={onRemove}
              onRename={onRename}
              youtubeQuotaFull={youtubeQuotaFull}
              nowMs={nowMs}
              busy={busy}
              highlighted={highlightedItemId === entry.item.id}
            />
          ) : (
            <ChannelEntryCard key={`c:${entry.video.videoId}`} time={entry.time} entry={entry} today={today} />
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
  nowMs,
  busy,
  highlighted
}: {
  platform: PlatformId;
  time: string;
  item: QueueItem;
  thumbnailForItem: (item: QueueItem) => string | null;
  today: boolean;
  onPublishNow: (item: QueueItem) => void;
  onRetry: (item: QueueItem, platform: PlatformId) => void;
  onEditCaption: (item: QueueItem, caption: string) => void;
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  youtubeQuotaFull?: boolean;
  nowMs: number;
  busy: string | null;
  highlighted?: boolean;
}) {
  const state = item.platforms[platform] as PlatformState;
  const url = remoteUrlFor(platform, state.postId);
  const thumbnailUrl = thumbnailForItem(item);
  // "failed" and "manual" are terminal until something un-blocks them, so the
  // send button re-arms the post first; the rest go straight out.
  const blocked = state.status === "failed" || state.status === "manual";
  const advice = blocked ? describeFailure(state, platform) : null;
  // A leg that is not failed but is not simply waiting: an error on record or a
  // later attempt booked. Without this line it reads exactly like a healthy one.
  const waiting = blocked ? null : describeWaiting(state, platform);
  const quotaWait = platform === "youtube" && state.status === "pending" && !state.postId && Boolean(youtubeQuotaFull);
  const inboxDraft = isTiktokInboxDraft(platform, state.status, item);
  const waitingLine = waiting
    ? state.nextAttemptAt
      ? `Retrying at ${formatGoLive(state.nextAttemptAt)} - ${waiting.headline}`
      : `Will retry - ${waiting.headline}`
    : quotaWait
      ? "YouTube's upload limit for today is used up. This goes up after the quota resets, nothing is lost."
      : inboxDraft
        ? `${TIKTOK_INBOX_ACTION} - it is not live until you do.`
        : null;
  const detailRaw = advice?.raw ?? waiting?.raw;
  const targets = publishNowTargets(item);
  // Publish now also reaches a post YouTube/Facebook is holding for its slot
  // (status "scheduled"): that is the case where it makes the post public now.
  const actionable = targets.includes(platform) || (blocked && advice?.action !== "none");
  const working = busy === `publish:${item.id}` || busy === `remove:${item.id}`;
  // A picture post has no poster frame — its own first slide IS the thumbnail,
  // served by position out of the queue so the card can reach files that live
  // under data/ and never appear in a URL.
  const pictures = isImagePost(item) ? imagePathsOf(item).length : 0;
  const [showSlides, setShowSlides] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [confirm, setConfirm] = useState<"publish" | "remove" | null>(null);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(item.caption ?? "");
  const slotPassed = new Date(item.publishAt).getTime() <= nowMs;
  const retryLabel = slotPassed ? "Retry now" : "Retry at slot";
  const retryHint = slotPassed
    ? `Put ${PLATFORM_LABELS[platform]} back in the queue and post it now. The post's other platforms are not touched.`
    : `Put ${PLATFORM_LABELS[platform]} back in the queue. It posts at its slot (${time}); the post's other platforms are not touched.`;
  const everyLegPublished = Object.values(item.platforms).every((leg) => leg?.status === "published");
  const youtubeVideoId = item.platforms.youtube?.postId;

  const send = () => {
    if (blocked) onRetry(item, platform);
    else setConfirm("publish");
  };
  const impact = removalImpact(item);
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
      title={advice?.headline ?? item.title}
    >
      {pictures > 0 ? (
        <a
          href={imagePostUrl(item.id, 0)}
          target="_blank"
          rel="noreferrer"
          title={pictures > 1 ? `Open slide 1 of ${pictures}` : "Open the picture"}
          className="relative block h-14 w-8 shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-black/40"
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
        <div className="flex items-baseline gap-1.5">
          <EditableTitle title={item.title} onRename={(title) => onRename(item, title)} />
          <span className="ml-auto shrink-0 text-[10px] font-medium text-[var(--muted-foreground)]">{time}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip
            status={state.status}
            platform={platform}
            item={item}
            youtubeQuotaFull={quotaWait}
            className="shrink-0"
          />
          {pictures > 0 ? (
            <button
              type="button"
              onClick={() => setShowSlides((shown) => !shown)}
              title={showSlides ? "Hide the files" : "Show every slide file"}
              className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] transition hover:bg-white/20 hover:text-white"
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
              className="shrink-0 text-[var(--accent)]"
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
              className="shrink-0 text-[var(--accent)]"
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
            </>
          )}
        </div>
        {editingCaption ? (
          <div className="mt-1.5 space-y-1">
            <Textarea
              value={captionDraft}
              onChange={(event) => setCaptionDraft(event.target.value)}
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
                disabled={!captionDraft.trim() || captionDraft.trim() === (item.caption ?? "").trim()}
                onClick={() => {
                  onEditCaption(item, captionDraft);
                  setEditingCaption(false);
                }}
              >
                Save caption
              </Button>
              <Button variant="ghost" className="h-7 px-2.5 text-[11px]" onClick={() => setEditingCaption(false)}>
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
                className="rounded-md border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
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
              {advice?.headline ?? waitingLine}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {advice?.action === "reconnect" && platform === "youtube" ? (
                <a
                  href={`/api/auth/google?account=${encodeURIComponent(item.accountId ?? primaryAccountIdFor("youtube"))}`}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/50 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
                >
                  <Plug className="h-3 w-3" /> Reconnect YouTube
                </a>
              ) : null}
              {advice?.action === "reconnect" && advice.viaSettings ? (
                <Link
                  href="/settings#accounts"
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/50 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
                >
                  <Plug className="h-3 w-3" /> Open Settings
                </Link>
              ) : null}
              {detailRaw ? (
                <button
                  type="button"
                  onClick={() => setShowRaw((shown) => !shown)}
                  className="text-[10px] font-medium text-[var(--muted-foreground)] underline-offset-2 transition hover:text-white hover:underline"
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
          description={`Publish "${item.title}" to ${labelList(targets) || PLATFORM_LABELS[platform]} now?`}
          confirmLabel="Publish now"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onPublishNow(item);
          }}
        >
          <p>
            This does not wait for the slot ({time}). Every platform above that has not finished posts immediately
            {targets.includes("youtube") ? ", and a YouTube video held for its slot is made public right away" : ""}.
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
          {!impact.youtube && !impact.facebook ? <p>Nothing has gone up yet, so nothing is left on any platform.</p> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** The text-labelled action buttons on a post card. */
const ACTION_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)] transition hover:bg-white/8 hover:text-white";

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
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} autoFocus>
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
          className="text-[var(--accent)]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href={studioVideoUrl(video.videoId)}
          target="_blank"
          rel="noreferrer"
          aria-label="Edit in YouTube Studio"
          title="Edit in YouTube Studio (title, description…)"
          className="text-[var(--accent)]"
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
        <span className={cn("text-[10px]", today && "font-medium text-[var(--accent)]")}>{slot.time}</span>
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
      <span className={cn("text-[10px]", today && "font-medium text-[var(--accent)]")}>{slot.time}</span>
      Drop a clip or video
      <button
        type="button"
        onClick={() => onRequestUpload(slot.utc)}
        className="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] opacity-70 transition hover:bg-[var(--accent)]/10 hover:opacity-100"
      >
        <Upload className="h-3 w-3" /> Upload clip
      </button>
    </div>
  );
}

/**
 * The clip's title on a filled slot, editable in place: click to edit, Enter
 * or blur commits (which renames the video on YouTube too when it's already
 * up), Escape cancels. Capped at YouTube's 100-character title limit.
 */
function EditableTitle({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
        aria-label="Rename video"
        title="Rename video"
        className="group flex min-w-0 flex-1 items-center gap-1 text-left"
      >
        <span className="min-w-0 truncate text-xs font-medium text-white">{title}</span>
        <Pencil className="h-3 w-3 shrink-0 text-[var(--muted-foreground)] opacity-0 transition group-hover:opacity-100" />
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
  };
  return (
    <input
      autoFocus
      value={draft}
      maxLength={100}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setDraft(title);
          setEditing(false);
        }
      }}
      aria-label="Video title"
      className="w-full min-w-0 flex-1 rounded border border-[var(--accent)]/50 bg-[var(--well-deep)] px-1 py-0.5 text-xs font-medium text-white outline-none"
    />
  );
}
