"use client";

import { useMemo } from "react";
import { CalendarDays, Repeat, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CAROUSEL_PLATFORMS, expandOccurrences } from "@/lib/carousels/schedule";
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
 * Upload Schedule: every scheduled carousel occurrence for the next four
 * weeks, grouped by day. Recurring schedules (e.g. daily at 12:00) fan out
 * into one row per day so the calendar reads like a real posting plan.
 */
export function ScheduleCalendar({
  carousels,
  onUnschedule
}: {
  carousels: Carousel[];
  onUnschedule: (carouselId: string, scheduleId: string) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const grouped = useMemo(() => {
    const occurrences = expandOccurrences(carousels, now, 28);
    const byDay = new Map<string, typeof occurrences>();
    for (const occurrence of occurrences) {
      if (!byDay.has(occurrence.dateKey)) byDay.set(occurrence.dateKey, []);
      byDay.get(occurrence.dateKey)!.push(occurrence);
    }
    return [...byDay.entries()];
  }, [carousels, now]);

  if (grouped.length === 0) return null;

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
        <h3 className="font-semibold text-white">Upload Schedule</h3>
        <span className="text-xs text-[var(--muted-foreground)]">next 4 weeks</span>
      </div>

      <div className="space-y-3">
        {grouped.map(([dateKey, occurrences]) => (
          <div key={dateKey} className="grid gap-2 sm:grid-cols-[7rem_1fr]">
            <div className="pt-1 text-xs font-medium text-white">{labelForDate(dateKey, todayKey)}</div>
            <div className="space-y-1.5">
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
                    onClick={() => onUnschedule(occurrence.carouselId, occurrence.scheduleId)}
                    aria-label="Remove schedule"
                    title="Remove this schedule"
                    className="shrink-0 text-[var(--muted-foreground)] transition hover:text-red-300"
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
