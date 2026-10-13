import { CAROUSEL_PLATFORMS, PLATFORM_LABEL, WEEKDAY_LABELS, type CarouselPlatformId } from "@/lib/carousels/schedule";
import { formatClockTime } from "@/lib/timeFormat";
import type { Carousel } from "@/types/domain";

/**
 * One row for a repeating weekly reminder: the same weekday and time, across
 * every date it fires, with the networks it targets listed together. `time`
 * stays the stored "HH:mm" (it sorts and keys the row); only the label is 12-hour.
 */
export type WeeklyReminderRow = {
  key: string;
  carouselId: string;
  carouselTitle: string;
  weekday: number;
  time: string;
  platforms: CarouselPlatformId[];
  /** Every saved schedule folded into this row, so Remove clears them all at once. */
  scheduleIds: string[];
  label: string;
};

/**
 * Folds every weekly reminder into one row per carousel, weekday and time.
 * A repeat on four Tuesdays is one row, not four, and two networks on the same
 * slot are listed on that row. The carousel stays in the key: two decks at the
 * same time are two reminders, and removing one must not remove the other.
 * Daily and one-off reminders are not handled here.
 */
export function weeklyReminderRows(carousels: Carousel[]): WeeklyReminderRow[] {
  const rows = new Map<string, WeeklyReminderRow & { order: Set<CarouselPlatformId> }>();
  for (const carousel of carousels) {
    for (const schedule of carousel.schedules ?? []) {
      if (schedule.recurrence !== "weekly") continue;
      const weekday = schedule.weekday ?? new Date(`${schedule.date}T12:00:00`).getDay();
      const key = `${carousel.id}|${weekday}|${schedule.time}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          carouselId: carousel.id,
          carouselTitle: carousel.title,
          weekday,
          time: schedule.time,
          platforms: [],
          scheduleIds: [],
          label: "",
          order: new Set()
        };
        rows.set(key, row);
      }
      row.scheduleIds.push(schedule.id);
      for (const platform of schedule.platforms as CarouselPlatformId[]) row.order.add(platform);
    }
  }
  const platformOrder = CAROUSEL_PLATFORMS.map((platform) => platform.id);
  return [...rows.values()]
    .map(({ order, ...row }) => {
      const platforms = platformOrder.filter((id) => order.has(id));
      const names = platforms.map((id) => PLATFORM_LABEL[id]).join(", ");
      return { ...row, platforms, label: `Every ${WEEKDAY_LABELS[row.weekday]} ${formatClockTime(row.time)}${names ? ` · ${names}` : ""}` };
    })
    .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.time.localeCompare(b.time) || a.carouselTitle.localeCompare(b.carouselTitle));
}
