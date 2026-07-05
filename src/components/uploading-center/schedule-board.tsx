"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Loader2, Send, Trash2 } from "lucide-react";
import { StatusChip } from "@/components/uploading-center/status-chip";
import { CLIP_DRAG_TYPE } from "@/components/uploading-center/clip-card";
import { remoteUrlFor } from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";

/**
 * 14-day schedule grid for one platform: a row per weekday, a column per
 * default slot (07:30 / 12:30 / 19:30 in the publish timezone). Filled slots
 * show the post with its status; empty future slots accept a dragged clip.
 */
export function ScheduleBoard({
  platform,
  slots,
  itemAtSlot,
  onDropClip,
  onPublishNow,
  onRemove,
  busy
}: {
  platform: PlatformId;
  slots: ScheduleSlot[];
  itemAtSlot: (platform: PlatformId, slotUtc: string) => QueueItem | undefined;
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

  const times = days[0]?.map((slot) => slot.time) ?? [];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `7rem repeat(${Math.max(1, times.length)}, minmax(0, 1fr))` }}
        >
          <div />
          {times.map((time) => (
            <div key={time} className="px-1 text-center text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              {time}
            </div>
          ))}
          {days.map((daySlots) => (
            <BoardRow
              key={daySlots[0].dateKey}
              platform={platform}
              daySlots={daySlots}
              itemAtSlot={itemAtSlot}
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
  dragOverSlot: string | null;
  setDragOverSlot: (id: string | null) => void;
  onDropClip: (slotUtc: string, clipKey: string) => void;
  onPublishNow: (item: QueueItem) => void;
  onRemove: (item: QueueItem) => void;
  busy: string | null;
}) {
  return (
    <>
      <div className="flex items-center px-1 text-xs font-medium text-white">{daySlots[0].dateLabel}</div>
      {daySlots.map((slot) => {
        const item = itemAtSlot(platform, slot.utc);
        if (item) {
          const state = item.platforms[platform] as PlatformState;
          const url = remoteUrlFor(platform, state.postId);
          const actionable = state.status === "pending" || state.status === "uploaded" || state.status === "failed";
          const working = busy === `publish:${item.id}` || busy === `remove:${item.id}`;
          return (
            <div
              key={slot.id}
              className="min-h-16 rounded-lg border border-[var(--border-strong)] bg-white/6 p-2"
              title={state.note ?? state.error ?? item.title}
            >
              <p className="truncate text-xs font-medium text-white">{item.title}</p>
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
          );
        }
        if (slot.past) {
          return <div key={slot.id} className="min-h-16 rounded-lg border border-[var(--border)] bg-transparent opacity-30" />;
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
              "flex min-h-16 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[11px] text-[var(--muted-foreground)] transition",
              dragOverSlot === slot.id && "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
            )}
          >
            Drop a clip
          </div>
        );
      })}
    </>
  );
}
