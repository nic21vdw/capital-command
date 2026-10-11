"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Download, Loader2, Repeat, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CAROUSEL_PLATFORMS, expandOccurrences } from "@/lib/carousels/schedule";
import { weeklyReminderRows } from "@/lib/carousels/reminderRows";
import type { Carousel } from "@/types/domain";

function labelForDate(dateKey: string, todayKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const tomorrow = (() => {
    const [ty, tm, td] = todayKey.split("-").map(Number);
    const t = new Date(ty, (tm ?? 1) - 1, (td ?? 1) + 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();
  if (dateKey === todayKey) return "Today";
  if (dateKey === tomorrow) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Reminders: every saved carousel reminder for the next four weeks, grouped by
 * day. A real booking lives in the publish queue instead. Daily reminders fan
 * out into one row per day; weekly ones are one row each (see weeklyReminderRows).
 */
export function ScheduleCalendar({
  carousels,
  onUnschedule,
  onPrepare
}: {
  carousels: Carousel[];
  onUnschedule: (carouselId: string, scheduleIds: string[]) => void;
  /** Render + hand off the carousel's slides so it's ready to post. */
  onPrepare: (carouselId: string) => Promise<void> | void;
}) {
  const [preparing, setPreparing] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const weekly = useMemo(() => weeklyReminderRows(carousels), [carousels]);

  const grouped = useMemo(() => {
    const occurrences = expandOccurrences(carousels, now, 28).filter((occurrence) => occurrence.recurrence !== "weekly");
    const byDay = new Map<string, typeof occurrences>();
    for (const occurrence of occurrences) {
      if (!byDay.has(occurrence.dateKey)) byDay.set(occurrence.dateKey, []);
      byDay.get(occurrence.dateKey)!.push(occurrence);
    }
    return [...byDay.entries()];
  }, [carousels, now]);

  if (grouped.length === 0 && weekly.length === 0) return null;

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
        <h3 className="font-semibold text-white">Reminders</h3>
        <span className="text-xs text-[var(--muted-foreground)]">
          dated: next 4 weeks; weekly: until removed - nothing here posts automatically. Booked Instagram and Facebook posts are in the Uploading Center.
        </span>
      </div>

      <div className="space-y-3">
        {weekly.length > 0 ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="pt-1 text-xs font-medium text-white">Weekly</div>
            <div className="min-w-0 space-y-1.5">
              {weekly.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2"
                >
                  <Repeat className="h-3 w-3 shrink-0 text-[var(--accent)]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--accent)]">{row.label}</span>
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">{row.carouselTitle}</span>
                  </span>
                  <button
                    type="button"
                    disabled={preparing !== null}
                    onClick={async () => {
                      setPreparing(row.carouselId);
                      try {
                        await onPrepare(row.carouselId);
                      } finally {
                        setPreparing(null);
                      }
                    }}
                    aria-label="Prepare for posting"
                    title="Render the slides now — ready to post"
                    className="shrink-0 text-[var(--muted-foreground)] transition hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    {preparing === row.carouselId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnschedule(row.carouselId, row.scheduleIds)}
                    aria-label="Remove reminder"
                    title="Remove this weekly reminder"
                    className="shrink-0 text-[var(--muted-foreground)] transition hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {grouped.map(([dateKey, occurrences]) => (
          <div key={dateKey} className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <div className="pt-1 text-xs font-medium text-white">{labelForDate(dateKey, todayKey)}</div>
            <div className="min-w-0 space-y-1.5">
              {occurrences.map((occurrence) => (
                <div
                  key={`${occurrence.scheduleId}-${occurrence.dateKey}`}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white/5 px-3 py-2"
                >
                  <span className="w-12 shrink-0 text-xs font-semibold text-[var(--accent)]">{occurrence.time}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{occurrence.carouselTitle}</span>
                  {occurrence.recurrence !== "once" ? (
                    <Repeat className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" aria-label={occurrence.recurrence} />
                  ) : null}
                  <div className="flex shrink-0 gap-1">
                    {occurrence.platforms.map((id) => {
                      const platform = CAROUSEL_PLATFORMS.find((p) => p.id === id);
                      return (
                        <span
                          key={id}
                          title={platform?.label}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                          style={{ background: platform?.color }}
                        >
                          {platform?.short}
                        </span>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={preparing !== null}
                    onClick={async () => {
                      setPreparing(occurrence.carouselId);
                      try {
                        await onPrepare(occurrence.carouselId);
                      } finally {
                        setPreparing(null);
                      }
                    }}
                    aria-label="Prepare for posting"
                    title="Render the slides now — ready to post"
                    className="flex shrink-0 items-center justify-center text-[var(--muted-foreground)] transition hover:text-[var(--accent)] disabled:opacity-50 max-sm:h-10 max-sm:w-10"
                  >
                    {preparing === occurrence.carouselId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnschedule(occurrence.carouselId, [occurrence.scheduleId])}
                    aria-label="Remove reminder"
                    title="Remove this reminder"
                    className="flex shrink-0 items-center justify-center text-[var(--muted-foreground)] transition hover:text-[var(--danger)] max-sm:h-10 max-sm:w-10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
