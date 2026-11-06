"use client";

import { CalendarClock, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BOOK_PLATFORMS,
  clipChoices,
  type BookDraft,
  type BookableClip,
  type BookingRecord
} from "@/components/uploading-center/book-clip";
import { PLATFORM_LABELS } from "@/components/uploading-center/use-uploading-center";
import { cn } from "@/lib/utils";
import type { SurfaceControl } from "@/lib/colateral/protocol";

const PHASE_TONE: Record<BookingRecord["phase"], string> = {
  idle: "",
  booking: "text-[var(--muted-foreground)]",
  booked: "text-emerald-300",
  refused: "text-amber-300"
};

export function BookClipPanel({
  draft,
  onDraftChange,
  clips,
  timezone,
  control,
  record,
  onBook
}: {
  draft: BookDraft;
  onDraftChange: (next: BookDraft) => void;
  clips: BookableClip[];
  timezone: string;
  control: SurfaceControl;
  record: BookingRecord;
  onBook: () => void;
}) {
  const [open, setOpen] = useState(false);
  const touched = Boolean(draft.clipKey || draft.platform || draft.at || draft.caption) || record.phase !== "idle";
  const shown = open || touched;
  const choices = clipChoices(clips);

  return (
    <section className="mb-4 rounded-lg border border-[var(--border)] bg-white/[0.03]" aria-label="Book one clip">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={shown}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-white"
      >
        <CalendarClock className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="flex-1">Book one clip at a set time</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition", !shown && "-rotate-90")} aria-hidden />
      </button>
      {shown ? (
        <div className="grid gap-3 border-t border-[var(--border)] p-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
            Clip
            <Select value={draft.clipKey} onChange={(event) => onDraftChange({ ...draft, clipKey: event.target.value })}>
              <option value="">Choose a clip</option>
              {choices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
            Platform
            <Select
              value={draft.platform}
              onChange={(event) => onDraftChange({ ...draft, platform: event.target.value as BookDraft["platform"] })}
            >
              <option value="">Choose a platform</option>
              {BOOK_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {PLATFORM_LABELS[platform]}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
            Post at ({timezone})
            <Input type="datetime-local" value={draft.at} onChange={(event) => onDraftChange({ ...draft, at: event.target.value })} />
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
            Caption (empty writes one)
            <Textarea
              className="min-h-11"
              value={draft.caption}
              onChange={(event) => onDraftChange({ ...draft, caption: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button onClick={onBook} disabled={control.disabled} title={control.hint}>
              Book
            </Button>
            <p className={cn("min-w-0 flex-1 text-xs", PHASE_TONE[record.phase])} role="status">
              {record.phase === "idle" ? control.disabled ? control.hint : "" : record.text}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
