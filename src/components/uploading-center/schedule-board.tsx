"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Loader2, Send, Trash2 } from "lucide-react";
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
 * future slots accept a dragged clip. On the YouTube board, slots whose time
 * matches a video already on the channel (scheduled in Studio, or published)
 * render that video read-only.
 */
export function ScheduleBoard({
  platform,
  slots,
  itemAtSlot,
  thumbnailForItem,
  channelVideoAtSlot,
  onDropClip,
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
  onPublishNow: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
  busy: string | null;
}) {
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);

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
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `7rem repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          <div />
          {headers.map((header, index) => (
            <div
              key={index}
              className="px-1 text-center text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]"
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
        return (
          <div
            key={slot.id}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(CLIP_DRAG_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragOverSlot(slot.id);
            }}
            onDragLeave={() => setDragOverSlot(null)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOverSlot(null);
              const clipKey = event.dataTransfer.getData(CLIP_DRAG_TYPE);
              if (clipKey) onDropClip(slot.utc, clipKey);
            }}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-[var(--border)] text-[11px] text-[var(--muted-foreground)] transition",
              isToday && "border-[var(--accent)]/50 bg-[var(--accent)]/5",
              dragOverSlot === slot.id && "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
            )}
          >
            <span className={cn("text-[10px]", isToday && "font-medium text-[var(--accent)]")}>{slot.time}</span>
            Drop a clip
          </div>
        );
      })}
    </>
  );
}
