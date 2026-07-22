"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { CAROUSEL_PLATFORMS, IMAGE_CAPABLE_PLATFORMS, WEEKDAY_LABELS, type CarouselPlatformId } from "@/lib/carousels/schedule";
import { cn } from "@/lib/utils";
import type { CarouselSchedule, ScheduleRecurrence } from "@/types/domain";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sch-${Date.now()}`);

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Schedules a carousel upload to one or more networks — once, daily, or
 * weekly at a fixed time (e.g. 12:00 PM every day). The schedule is saved on
 * the carousel and expanded onto the Upload Schedule calendar.
 */
export function ScheduleModal({
  open,
  carouselTitle,
  onClose,
  onCreate,
  saving
}: {
  open: boolean;
  carouselTitle: string;
  onClose: () => void;
  onCreate: (schedule: CarouselSchedule) => void | Promise<void>;
  saving: boolean;
}) {
  const [platforms, setPlatforms] = useState<CarouselPlatformId[]>(["instagram"]);
  const [time, setTime] = useState("12:00");
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>("daily");
  const [date, setDate] = useState(todayKey());
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [caption, setCaption] = useState("");

  const togglePlatform = (id: CarouselPlatformId) =>
    setPlatforms((current) => (current.includes(id) ? current.filter((p) => p !== id) : [...current, id]));

  const create = async () => {
    if (platforms.length === 0) return void toast.error("Pick at least one platform.");
    const schedule: CarouselSchedule = {
      id: uid(),
      platforms,
      time,
      recurrence,
      date: recurrence === "once" ? date : todayKey(),
      weekday: recurrence === "weekly" ? weekday : undefined,
      caption: caption.trim() || undefined,
      createdAt: new Date().toISOString()
    };
    await onCreate(schedule);
  };

  const manualOnly = platforms.filter((p) => !IMAGE_CAPABLE_PLATFORMS.includes(p));

  return (
    <Modal open={open} title="Schedule upload" description={`Plan when “${carouselTitle}” goes out.`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Platforms</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CAROUSEL_PLATFORMS.map((platform) => {
              const active = platforms.includes(platform.id);
              return (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => togglePlatform(platform.id)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                      : "border-[var(--border)] bg-white/5 text-[var(--muted-foreground)] hover:text-white"
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: platform.color }} />
                  {platform.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[var(--muted-foreground)]">
            Repeat
            <Select value={recurrence} onChange={(event) => setRecurrence(event.target.value as ScheduleRecurrence)} className="mt-1">
              <option value="once">Once</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
            </Select>
          </label>
          <label className="block text-xs text-[var(--muted-foreground)]">
            Time
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-white outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>

        {recurrence === "once" ? (
          <label className="block text-xs text-[var(--muted-foreground)]">
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-white outline-none focus:border-[var(--accent)]"
            />
          </label>
        ) : recurrence === "weekly" ? (
          <label className="block text-xs text-[var(--muted-foreground)]">
            Weekday
            <Select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} className="mt-1">
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <label className="block text-xs text-[var(--muted-foreground)]">
          Caption (optional)
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={2}
            placeholder="First-comment caption / post copy…"
            className="mt-1 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
          />
        </label>

        {manualOnly.length > 0 ? (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-[11px] text-amber-100">
            {manualOnly.map((p) => CAROUSEL_PLATFORMS.find((c) => c.id === p)?.label).join(", ")} doesn&apos;t take image
            carousels through the auto-publisher yet — those occurrences are tracked as reminders to post by hand at the
            scheduled time.
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
}
