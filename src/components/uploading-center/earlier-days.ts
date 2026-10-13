import type { AgendaDay } from "@/lib/publisher/agenda";

/**
 * The board's window starts a week back so history stays reachable, which used
 * to mean the page was scrolled down to today on load - past the Failed strip,
 * the platform tabs and the bulk button. The board now opens ON today and keeps
 * the days before it behind one "Show earlier days" row, so the top of the page
 * is the top of the page.
 *
 * Only days before today fold away, and only when today is in the window: a
 * window paged wholly into the past or the future shows every day it has.
 *
 * Only earlier days that HAVE posts count and, once opened, only those are
 * drawn. A week of "No posts this day" rows said nothing and pushed today a
 * screen and a half down; the button's count is the days worth opening.
 * `keepDateKey` keeps one empty earlier day when something has been asked to be
 * shown there (a `?day=` link), so the scroll has a band to land on.
 */
export function splitEarlierDays(
  days: AgendaDay[],
  collapse: boolean,
  keepDateKey?: string | null
): { earlier: AgendaDay[]; shown: AgendaDay[]; earlierPosts: number } {
  const todayIndex = days.findIndex((day) => day.today);
  if (todayIndex <= 0) return { earlier: [], shown: days, earlierPosts: 0 };
  const before = days.slice(0, todayIndex);
  const onward = days.slice(todayIndex);
  if (!collapse) {
    const kept = before.filter((day) => day.entries.length > 0 || day.dateKey === keepDateKey);
    return { earlier: [], shown: [...kept, ...onward], earlierPosts: 0 };
  }
  const earlier = before.filter((day) => day.entries.length > 0);
  const earlierPosts = earlier.reduce((sum, day) => sum + day.entries.length, 0);
  return { earlier, shown: onward, earlierPosts };
}
