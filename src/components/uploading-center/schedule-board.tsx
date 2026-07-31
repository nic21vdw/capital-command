"use client";

import { useRef, useState } from "react";
import {
  Clapperboard,
  ClockArrowUp,
  ExternalLink,
  Loader2,
  Pencil,
  Send,
  SlidersHorizontal,
  Trash2,
  Upload
} from "lucide-react";
import { toast } from "sonner";
import { RevisePostModal } from "@/components/uploading-center/revise-post-modal";
import { StatusChip } from "@/components/uploading-center/status-chip";
import { CLIP_DRAG_TYPE } from "@/components/uploading-center/clip-card";
import { remoteUrlFor, studioVideoUrl } from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import type { AgendaDay, AgendaEntry } from "@/lib/publisher/agenda";
import { isMovable, type RevisePatch } from "@/lib/publisher/revise";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

/**
 * Day-by-day schedule calendar for one platform. Every scheduled post and every
 * video already on the channel shows on the day it goes live, at its real time —
 * whether it lands on one of the three daily slots (07:30 / 12:30 / 19:30 on
 * weekdays, 10:00 / 13:00 / 19:00 on weekends) or somewhere in between (a 14:30
 * upload sits on its day too). The remaining open slots for a future day render
 * as drop targets: drop a queue clip, drop a video file straight from the
 * computer, or use the Upload button. Past days keep their history but offer no
 * new slots. This is the whole picture in one place — nothing floats in a list
 * below the calendar anymore.
 */

/** A dropped/picked file counts as video by MIME type or a known extension. */
function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
}

export function ScheduleBoard({
  platform,
  days,
  thumbnailForItem,
  timeZone,
  accounts,
  onDropClip,
  onUploadVideo,
  onSelectSlot,
  onPublishNow,
  onRemove,
  onRename,
  onRevise,
  onSkip,
  onShiftDay,
  busy
}: {
  platform: PlatformId;
  /** The visible window, one entry per day, already placed and sorted. */
  days: AgendaDay[];
  thumbnailForItem: (item: QueueItem) => string | null;
  /** Publish timezone, so revised times read back in the creator's clock. */
  timeZone: string;
  /** This platform's accounts, for reassigning a post. */
  accounts: { id: string; platform: PlatformId; label: string }[];
  onDropClip: (slotUtc: string, clipKey: string) => void;
  /** A video file from the user's computer dropped on (or picked for) a slot. */
  onUploadVideo: (slotUtc: string, file: File) => void;
  /** When set (a clip is being placed), open slots become click targets. */
  onSelectSlot?: (slotUtc: string) => void;
  onPublishNow: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  onRevise: (item: QueueItem, patch: RevisePatch) => Promise<boolean>;
  onSkip: (item: QueueItem) => Promise<boolean>;
  onShiftDay: (dateKey: string, minutes: number) => Promise<boolean>;
  busy: string | null;
}) {
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  // One dialog for the whole board — the cards are too small to edit in place.
  const [revising, setRevising] = useState<QueueItem | null>(null);
  // The board re-renders from the refreshed queue after a save, so the open
  // dialog reads its item back out of `days` rather than holding a stale copy.
  const revisingItem = revising
    ? days
        .flatMap((day) => day.entries)
        .flatMap((entry) => (entry.kind === "queue" ? [entry.item] : []))
        .find((item) => item.id === revising.id) ?? revising
    : null;

  // One hidden file input for the whole board; the slot whose Upload button
  // opened the picker is remembered so the chosen file lands on it.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSlotRef = useRef<string | null>(null);
  const requestUpload = (slotUtc: string) => {
    uploadSlotRef.current = slotUtc;
    fileInputRef.current?.click();
  };

  return (
    // Bounded, scrollable pane so the calendar can grow tall without pushing the
    // rest of the page down; days scroll inside it.
    <div className="max-h-[calc(100vh-7rem)] space-y-2 overflow-auto pr-1">
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
          onRemove={onRemove}
          onRename={onRename}
          onRevise={setRevising}
          onShiftDay={onShiftDay}
          busy={busy}
        />
      ))}
      {revisingItem ? (
        <RevisePostModal
          item={revisingItem}
          timeZone={timeZone}
          accounts={accounts}
          busy={busy === `revise:${revisingItem.id}` || busy === `skip:${revisingItem.id}`}
          onClose={() => setRevising(null)}
          onSave={(patch) => onRevise(revisingItem, patch)}
          onSkip={() => onSkip(revisingItem)}
        />
      ) : null}
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
  onRemove,
  onRename,
  onRevise,
  onShiftDay,
  busy
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
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  onRevise: (item: QueueItem) => void;
  onShiftDay: (dateKey: string, minutes: number) => Promise<boolean>;
  busy: string | null;
}) {
  const { today, past, entries, openSlots } = day;
  const empty = entries.length === 0 && openSlots.length === 0;
  // Not `!past`: that flag means the day has no slots left to schedule into,
  // which says nothing about whether its posts can still move.
  const canShift = entries.some((entry) => entry.kind === "queue" && isMovable(entry.item));
  return (
    <div
      className={cn(
        "grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 rounded-xl border p-2.5",
        today ? "border-[var(--accent)]/40 bg-[var(--accent)]/5" : "border-[var(--border)]",
        past && !today && "opacity-80"
      )}
    >
      <div className="flex flex-col gap-1 pt-1">
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
        {/* Move the whole day at once — the morning you decide everything
            should run later. */}
        {canShift ? (
          <DayShift dateKey={day.dateKey} onShiftDay={onShiftDay} busy={busy === `shift:${day.dateKey}`} />
        ) : null}
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(13.5rem,1fr))]">
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
              onRemove={onRemove}
              onRename={onRename}
              onRevise={onRevise}
              busy={busy}
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
            {past ? "No posts this day" : "No open slots"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Shift every still-movable post of one day. Collapsed to a single control so
 * the day column stays a date, not a toolbar; the amounts match the nudges in
 * the revise dialog so the two read as one system.
 */
function DayShift({
  dateKey,
  onShiftDay,
  busy
}: {
  dateKey: string;
  onShiftDay: (dateKey: string, minutes: number) => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (busy) return <Loader2 className="h-3 w-3 animate-spin text-[var(--muted-foreground)]" />;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Move this whole day"
        className="flex w-fit items-center gap-1 text-[10px] text-[var(--muted-foreground)] transition hover:text-white"
      >
        <ClockArrowUp className="h-3 w-3" />
        Shift day
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {[-60, -15, 15, 60].map((minutes) => (
        <button
          key={minutes}
          type="button"
          onClick={() => void onShiftDay(dateKey, minutes).then(() => setOpen(false))}
          className="rounded border border-[var(--border)] px-1 py-0.5 text-[10px] text-[var(--muted-foreground)] transition hover:border-[var(--border-strong)] hover:text-white"
        >
          {minutes > 0 ? `+${minutes}` : minutes}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-1 text-[10px] text-[var(--muted-foreground)] transition hover:text-white"
      >
        ✕
      </button>
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
  onRemove,
  onRename,
  onRevise,
  busy
}: {
  platform: PlatformId;
  time: string;
  item: QueueItem;
  thumbnailForItem: (item: QueueItem) => string | null;
  today: boolean;
  onPublishNow: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
  onRename: (item: QueueItem, title: string) => void;
  onRevise: (item: QueueItem) => void;
  busy: string | null;
}) {
  const state = item.platforms[platform] as PlatformState;
  const url = remoteUrlFor(platform, state.postId);
  const thumbnailUrl = thumbnailForItem(item);
  const actionable = state.status === "pending" || state.status === "uploaded" || state.status === "failed";
  const working =
    busy === `publish:${item.id}` ||
    busy === `remove:${item.id}` ||
    busy === `revise:${item.id}` ||
    busy === `skip:${item.id}`;
  return (
    <div
      className={cn(
        "flex min-h-16 gap-2 rounded-lg border border-[var(--border-strong)] bg-white/6 p-2",
        today && "border-[var(--accent)]/40"
      )}
      title={state.note ?? state.error ?? item.title}
    >
      {thumbnailUrl ? (
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
        <div className="mt-1.5 flex items-center gap-1.5">
          <StatusChip status={state.status} />
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label="View the video"
              title="View the video"
              className="text-[var(--accent)]"
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
              className="text-[var(--accent)]"
            >
              <Clapperboard className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <span className="flex-1" />
          {working ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
          ) : (
            <>
              <button
                type="button"
                onClick={() => onRevise(item)}
                aria-label="Revise post"
                title="Revise — time, caption, visibility, account, platforms"
                className="text-[var(--muted-foreground)] transition hover:text-white"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
              {actionable ? (
                <button
                  type="button"
                  onClick={() => onPublishNow(item)}
                  aria-label="Publish now"
                  title="Publish now"
                  className="text-[var(--muted-foreground)] transition hover:text-white"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label="Remove from schedule"
                title="Remove from schedule"
                className="text-[var(--muted-foreground)] transition hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
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
