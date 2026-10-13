export type CalendarViewMode = "day" | "week" | "month";

/** Below Tailwind's `sm`: the width where a seven-column week stops fitting. */
export const NARROW_VIEWPORT_QUERY = "(max-width: 639px)";

/**
 * The view the calendar opens on when nobody has chosen one. A week is seven
 * columns that scroll sideways on a phone, so a narrow screen opens on the day
 * instead; anything wider keeps the week.
 */
export function defaultCalendarView(narrowViewport: boolean): CalendarViewMode {
  return narrowViewport ? "day" : "week";
}

/** Reads the viewport once. Safe to call during render only on the client. */
export function viewportIsNarrow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}
