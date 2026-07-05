"use client";

import { useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { StatusChip } from "@/components/uploading-center/status-chip";
import { CLIP_DRAG_TYPE } from "@/components/uploading-center/clip-card";
import { remoteUrlFor } from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

/**
 * 14-day schedule grid for one platform, starting today (highlighted): a row
 * per day, a column per slot. Weekday and weekend slot times differ (07:30 /
 * 12:30 / 19:30 vs 10:00 / 13:00 / 19:00), so each cell carries its own time
 * label. Filled slots show the clip's poster frame with its status; empty
 * future slots accept a dragged clip, a video file dropped straight from the
 * computer, or an Upload-button pick. On the YouTube board, slots whose time
 * matches a video already on the channel (scheduled in Studio, or published)
 * render that video read-only.
 */

/** A dropped/picked file counts as video by MIME type or a known extension. */
function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
}

export function ScheduleBoard({
  platform,
  slots,
  itemAtSlot,
  thumbnailForItem,
  channelVideoAtSlot,
  onDropClip,
  onUploadVideo,
  onSelectSlot,
  onPublishNow,
  onRemove,
  busy
}: {
  platform: PlatformId;
  slots: ScheduleSlot[];
  itemAtSlot: (platform: PlatformId, slotUtc: string) => QueueItem | undefined;
  thumbnailForItem: (item: QueueItem) => string | null;
  /** YouTube only: a video already on the channel occupying this exact slot. */
  channelVideoAtSlot?: (slotUtc: string) => ChannelVideo | undefined;
  onDropClip: (slotUtc: string, clipKey: string) => void;
  /** A video file from the user's computer dropped on (or picked for) a slot. */
  onUploadVideo: (slotUtc: string, file: File) => void;
  /** When set (a clip is being placed), open slots become click targets. */
  onSelectSlot?: (slotUtc: string) => void;
  onPublishNow: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
  busy: string | null;
}) {
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);

  // One hidden file input for the whole board; the slot whose Upload button
  // opened the picker is remembered so the chosen file lands on it.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSlotRef = useRef<string | null>(null);
  const requestUpload = (slotUtc: string) => {
    uploadSlotRef.current = slotUtc;
    fileInputRef.current?.click();
  };

  const days = useMemo(() => {
    const byDate = new Map<string, ScheduleSlot[]>();
    for (const slot of slots) {
      if (!byDate.has(slot.dateKey)) byDate.set(slot.dateKey, []);
      byDate.get(slot.dateKey)!.push(slot);
    }
    return [...byDate.values()];
  }, [slots]);

  // Weekday and weekend rows share columns by position; a header shows both
  // times when they differ (e.g. "07:30 / 10:00").
  const columnCount = Math.max(1, ...days.map((daySlots) => daySlots.length));
  const headers = Array.from({ length: columnCount }, (_, index) =>
    [...new Set(days.map((daySlots) => daySlots[index]?.time).filter(Boolean))].join(" / ")
  );

  return (
    // Bounded, scrollable pane so the slot-time header row can freeze in place
    // ("frozen pane") while the 14 days scroll under it. A plain window-sticky
    // header can't work here: this wrapper scrolls horizontally on narrow
    // screens, and any overflow container makes `overflow-y` a scroll context
    // that would trap a `top-0` sticky against the wrapper instead of the page.
    <div className="max-h-[calc(100vh-8rem)] overflow-auto">
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
      <div className="min-w-[560px]">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `7rem repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          <div className="sticky top-0 z-20 bg-[var(--background)]" />
          {headers.map((header, index) => (
            <div
              key={index}
              className="sticky top-0 z-20 bg-[var(--background)] px-1 pb-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]"
            >
              {header}
            </div>
          ))}
          {days.map((daySlots) => (
            <BoardRow
              key={daySlots[0].dateKey}
              platform={platform}
              daySlots={daySlots}
              itemAtSlot={itemAtSlot}
              thumbnailForItem={thumbnailForItem}
              channelVideoAtSlot={channelVideoAtSlot}
              dragOverSlot={dragOverSlot}
              setDragOverSlot={setDragOverSlot}
              onDropClip={onDropClip}
              onUploadVideo={onUploadVideo}
              onRequestUpload={requestUpload}
              onSelectSlot={onSelectSlot}
              onPublishNow={onPublishNow}
              onRemove={onRemove}
              busy={busy}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BoardRow({
  platform,
  daySlots,
  itemAtSlot,
  thumbnailForItem,
  channelVideoAtSlot,
  dragOverSlot,
  setDragOverSlot,
  onDropClip,
  onUploadVideo,
  onRequestUpload,
  onSelectSlot,
  onPublishNow,
  onRemove,
  busy
}: {
  platform: PlatformId;
  daySlots: ScheduleSlot[];
  itemAtSlot: (platform: PlatformId, slotUtc: string) => QueueItem | undefined;
  thumbnailForItem: (item: QueueItem) => string | null;
  channelVideoAtSlot?: (slotUtc: string) => ChannelVideo | undefined;
  dragOverSlot: string | null;
  setDragOverSlot: (id: string | null) => void;
  onDropClip: (slotUtc: string, clipKey: string) => void;
  onUploadVideo: (slotUtc: string, file: File) => void;
  /** Opens the board's file picker targeting this slot. */
  onRequestUpload: (slotUtc: string) => void;
  onSelectSlot?: (slotUtc: string) => void;
  onPublishNow: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
  busy: string | null;
}) {
  const isToday = daySlots[0].today;
  return (
    <>
      <div className={cn("flex items-center gap-1.5 px-1 text-xs font-medium text-white", isToday && "text-[var(--accent)]")}>
        {daySlots[0].dateLabel}
        {isToday ? (
          <span className="rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            Today
          </span>
        ) : null}
      </div>
      {daySlots.map((slot) => {
        const item = itemAtSlot(platform, slot.utc);
        if (item) {
          const state = item.platforms[platform] as PlatformState;
          const url = remoteUrlFor(platform, state.postId);
          const thumbnailUrl = thumbnailForItem(item);
          const actionable = state.status === "pending" || state.status === "uploaded" || state.status === "failed";
          const working = busy === `publish:${item.id}` || busy === `remove:${item.id}`;
          return (
            <div
              key={slot.id}
              className={cn(
                "flex min-h-16 gap-2 rounded-lg border border-[var(--border-strong)] bg-white/6 p-2",
                isToday && "border-[var(--accent)]/40"
              )}
              title={state.note ?? state.error ?? item.title}
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-14 w-8 shrink-0 rounded-md border border-[var(--border)] object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <p className="min-w-0 truncate text-xs font-medium text-white">{item.title}</p>
                  <span className="ml-auto shrink-0 text-[10px] text-[var(--muted-foreground)]">{slot.time}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <StatusChip status={state.status} />
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" aria-label="Open on YouTube" className="text-[var(--accent)]">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <span className="flex-1" />
                  {working ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted-foreground)]" />
                  ) : (
                    <>
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
        const video = channelVideoAtSlot?.(slot.utc);
        if (video) {
          // Already occupied on YouTube itself — read-only: it wasn't created
          // by this queue, so it can only be managed from YouTube Studio.
          return (
            <div
              key={slot.id}
              className="min-h-16 rounded-lg border border-[var(--border-strong)] bg-white/6 p-2"
              title={video.title}
            >
              <p className="truncate text-xs font-medium text-white">{video.title}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <StatusChip status={video.status} />
                <a
                  href={video.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open on YouTube"
                  className="text-[var(--accent)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <span className="flex-1" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  On YouTube
                </span>
              </div>
            </div>
          );
        }
        if (slot.past) {
          return (
            <div
              key={slot.id}
              className={cn(
                "flex min-h-16 items-center justify-center rounded-lg border border-[var(--border)] bg-transparent text-[11px] text-[var(--muted-foreground)] opacity-30",
                isToday && "border-[var(--accent)]/40 opacity-50"
              )}
            >
              {slot.time}
            </div>
          );
        }
        const uploading = busy === `upload:${platform}:${slot.utc}`;
        if (uploading) {
          return (
            <div
              key={slot.id}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--accent)]/50 bg-[var(--accent)]/5 text-[11px] text-[var(--muted-foreground)]"
            >
              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
              Uploading…
            </div>
          );
        }
        if (onSelectSlot) {
          // Placement mode (arriving from the editor's Schedule Short): every
          // open slot is a one-click target for the pre-selected clip.
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => onSelectSlot(slot.utc)}
              className={cn(
                "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-[var(--accent)]/50 bg-[var(--accent)]/5 text-[11px] text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 hover:text-white",
                isToday && "border-[var(--accent)]/70"
              )}
            >
              <span className={cn("text-[10px]", isToday && "font-medium text-[var(--accent)]")}>{slot.time}</span>
              Schedule here
            </button>
          );
        }
        return (
          <div
            key={slot.id}
            onDragOver={(event) => {
              // Accept a clip card from the queue or a video file dragged in
              // from the computer (file drags expose only the "Files" type).
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
              isToday && "border-[var(--accent)]/50 bg-[var(--accent)]/5",
              dragOverSlot === slot.id && "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
            )}
          >
            <span className={cn("text-[10px]", isToday && "font-medium text-[var(--accent)]")}>{slot.time}</span>
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
      })}
    </>
  );
}
