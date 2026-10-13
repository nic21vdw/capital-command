/**
 * What the YouTube number on the Day Summary is called. It is a lifetime count
 * of the videos posted in the window - not views earned in it - so every label
 * says "so far" and names the posting window. Pure, so the wording is tested.
 */

/** "yesterday", "today", or "on Friday, October 9" for any other day. */
export function postedWhen(relative: string, fullDayLabel: string): string {
  const lower = relative.toLowerCase();
  return lower === "today" || lower === "yesterday" || lower === "tomorrow" ? lower : `on ${fullDayLabel}`;
}

/** The label above one day's YouTube numbers. */
export function dayViewsLabel(videos: number, relative: string, fullDayLabel: string): string {
  const when = postedWhen(relative, fullDayLabel);
  if (videos <= 0) return `Views so far on videos posted ${when}`;
  return videos === 1 ? `Views so far on the video posted ${when}` : `Views so far on the ${videos} videos posted ${when}`;
}

/** The label above the last seven days' YouTube numbers. */
export const WEEK_VIEWS_LABEL = "Views so far on videos posted in the last 7 days";

/** True when the day's numbers are the week's own: the day is the week's only YouTube posting. */
export function sameAsWeek(
  day: { views: number; likes: number; videos: number },
  week: { views: number; likes: number; videos: number } | null | undefined
): boolean {
  return Boolean(week) && day.videos > 0 && day.videos === week!.videos && day.views === week!.views && day.likes === week!.likes;
}
