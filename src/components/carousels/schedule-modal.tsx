"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  CAROUSEL_PLATFORMS,
  DEFAULT_CAROUSEL_PLATFORMS,
  planCarouselSchedule,
  anyPlatformPostsItself,
  platformPostingMode,
  WEEKDAY_LABELS,
  type PlatformConnectionMap,
  type CarouselPlatformId
} from "@/lib/carousels/schedule";
import { usePlatformConnections } from "@/lib/publisher/usePlatformConnections";
import { cn } from "@/lib/utils";
import type { CarouselSchedule, ScheduleRecurrence } from "@/types/domain";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sch-${Date.now()}`);

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function tomorrowKey(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

/**
 * Plans a carousel post. A one-off to Instagram/Facebook is BOOKED: the page
 * sends it to the publish queue and it posts itself at the slot. Everything else
 * (a repeat, TikTok, YouTube) is a REMINDER saved on the carousel and shown on
 * the Reminders list - nothing posts automatically. The button says which.
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
  const [platforms, setPlatforms] = useState<CarouselPlatformId[]>([...DEFAULT_CAROUSEL_PLATFORMS]);
  const [time, setTime] = useState("12:00");
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>("once");
  const [date, setDate] = useState(tomorrowKey());
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [caption, setCaption] = useState("");

  const links = usePlatformConnections();
  // Unknown (still loading) stays undefined so nothing is called disconnected on a guess.
  const connected: PlatformConnectionMap | undefined = links
    ? Object.fromEntries(CAROUSEL_PLATFORMS.map((p) => [p.id, links[p.id]?.connected ?? false]))
    : undefined;

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

  const plan = planCarouselSchedule(platforms, recurrence);
  const bookable = plan.book.filter((id) => platformPostingMode(id, connected) === "automatic");
  const unlinked = plan.book.filter((id) => platformPostingMode(id, connected) === "reminder");
  // The route still books a disconnected network (as a manual reminder in the queue), but
  // the owner should only be told the post "posts itself" when something really will.
  const books = plan.book.length > 0 && anyPlatformPostsItself(plan.book, connected);
  const label = (ids: CarouselPlatformId[]) => ids.map((p) => CAROUSEL_PLATFORMS.find((c) => c.id === p)?.label).join(", ");
  const sentence = (ids: CarouselPlatformId[]) => label(ids).replace(/, ([^,]*)$/, " and $1");

  return (
    <Modal
      open={open}
      title="Schedule carousel"
      description={`Book “${carouselTitle}” to post itself, or save a reminder.`}
      onClose={onClose}
    >
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
                  <span className="flex flex-col items-start text-left leading-tight">
                    {platform.label}
                    <span className="text-[9px] font-normal uppercase tracking-wide text-[var(--muted-foreground)]">
                      {{
                        automatic: "Automatic",
                        reminder: "Not connected - saved as a reminder",
                        manual: "Manual"
                      }[platformPostingMode(platform.id, connected)]}
                    </span>
                  </span>
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
              min={tomorrowKey()}
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
          Caption (optional, written for you if left empty)
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={2}
            placeholder="Post copy..."
            className="mt-1 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
          />
        </label>

        {books ? (
          <p className="tone-info tone-edge tone-soft tone-text rounded-lg border p-2.5 text-[11px]">
            {label(bookable)} will be booked in the publish queue and post by themselves at that time. Nothing can be
            booked for today - the earliest is tomorrow.
          </p>
        ) : null}
        {unlinked.length > 0 ? (
          <p className="tone-warning tone-edge tone-soft tone-text rounded-lg border p-2.5 text-[11px]">
            {sentence(unlinked)} {unlinked.length > 1 ? "aren't" : "isn't"} connected, so {unlinked.length > 1 ? "they are" : "it is"}{" "}
            saved as a reminder and you post the slides by hand. Connect {unlinked.length > 1 ? "them" : "it"} in Settings to
            have {unlinked.length > 1 ? "them" : "it"} post by itself.
          </p>
        ) : null}
        {plan.remind.length > 0 ? (
          <p className="tone-warning tone-edge tone-soft tone-text rounded-lg border p-2.5 text-[11px]">
            {recurrence !== "once"
              ? "A repeating schedule is a reminder only - nothing posts automatically. Choose Once to book Instagram and Facebook."
              : `${label(plan.remind)} can't take picture posts from the app (manual - you post the slides yourself), so ${
                  plan.remind.length > 1 ? "those get" : "that gets"
                } a reminder on the Reminders list instead.`}
          </p>
        ) : null}

        <div className="sticky -bottom-6 -mx-6 -mb-6 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--panel)] px-6 py-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            {books ? "Book post" : "Save reminder"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
