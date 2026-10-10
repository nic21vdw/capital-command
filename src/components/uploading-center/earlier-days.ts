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
 */
export function splitEarlierDays(
  days: AgendaDay[],
  collapse: boolean
): { earlier: AgendaDay[]; shown: AgendaDay[]; earlierPosts: number } {
  const todayIndex = days.findIndex((day) => day.today);
  if (!collapse || todayIndex <= 0) return { earlier: [], shown: days, earlierPosts: 0 };
  const earlier = days.slice(0, todayIndex);
  const earlierPosts = earlier.reduce((sum, day) => sum + day.entries.length, 0);
  return { earlier, shown: days.slice(todayIndex), earlierPosts };
}
